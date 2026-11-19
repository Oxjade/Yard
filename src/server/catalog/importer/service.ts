import "server-only"
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { foundingPatchBody } from "@/lib/api/contracts/founding"
import {
  IMPORT_ITEM_STATUSES,
  IMPORT_MAX_IMAGES,
  importChoiceBody,
  type ImportBrandContextDto,
  type ImportBrandDto,
  type ImportChoiceBody,
  type ImportDetailDto,
  type ImportItemStatus,
  type ImportListDto,
  type ImportPlatform,
  type ImportProductDto,
  type ImportProgressDto,
  type ImportRunBody,
  type ImportScanBody,
  type ImportStatus,
  type ImportSummaryDto,
} from "@/lib/api/contracts/imports"
import { adminRolePermissions, canAdmin, type AdminRole } from "@/lib/permissions"
import { writeAudit } from "../../audit"
import type { AdminActor } from "../../auth/dal"
import { db, withTx, type Executor } from "../../db"
import { adminMembers, brands, users } from "../../db/schema"
import { catalogCategories, catalogProducts, productProposals, storefrontDrafts } from "../../db/schema/catalog"
import { catalogImportItems, catalogImports } from "../../db/schema/imports"
import { shippingProfiles } from "../../db/schema/shipping"
import { badRequest, conflict, forbidden, HttpError, notFound, rateLimited, rule } from "../../http/errors"
import { newId } from "../../ids"
import { log } from "../../log"
import { authorizeAdminUpload } from "../../media/authorize"
import { ingestBytes } from "../../media/upload"
import { hit } from "../../security/rate-limit"
import { yard } from "../../state"
import { adminProposalCreateBody } from "../contracts"
import { updateFoundingBrand } from "../founding"
import { createProposal, tellBrandOfImport } from "../proposals"
import { refuseSampleBrand } from "../sample-guard"
import { FetchRefused, IMAGE_CAP, safeGet } from "./fetch"
import { proposalBodyOf, type Existing } from "./normalize"
import { scanSite, siteFetcher, startUrlOf } from "./scan"
import { cleanUrl, ImportUrlError } from "./url"

/**
 * Import from website (docs/IMPORTER.md). An admin with catalog.propose (and brands.founding for an
 * unclaimed founding brand) pastes a brand's shop address and confirms the brand agreed; a
 * background runner scans the site (scan.ts), the admin ticks and edits products in the preview,
 * then the runner copies each product's photos into Yard through the upload pipeline
 * (media/upload.ts ingestBytes: the same sniffing, stripping and size rules as an upload) and sends
 * the product to the brand as a Suggestion from Yard (proposals.ts createProposal), one at a time,
 * recording each outcome. Nothing reaches the catalogue until the brand accepts, or the claim of a
 * founding brand set to "Go live when they claim" accepts it for them.
 *
 * The runner claims an import with a lease (catalog_imports.lease_until): a restart, or the
 * scheduler a minute later, resumes it. Every step is audited.
 */

type Row = typeof catalogImports.$inferSelect
type ItemRow = typeof catalogImportItems.$inferSelect

const LEASE_MS = 3 * 60_000
const MAX_ATTEMPTS = 3
const auditActor = (a: AdminActor) => ({ kind: "admin" as const, id: a.userId, name: a.name, role: a.role })

/* ---------- brand and permission ---------- */

async function loadBrand(d: Executor, brandId: string) {
  refuseSampleBrand(brandId)
  const [b] = await d.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!b) throw notFound("That brand isn't on Yard.")
  return b
}
type BrandRow = Awaited<ReturnType<typeof loadBrand>>

const isUnclaimedFounding = (b: BrandRow) => b.founding && b.claimStatus === "unclaimed"

/** catalog.propose is checked by the route; an unclaimed founding brand is Yard setup territory (brands.founding). */
function assertMayImport(admin: AdminActor, b: BrandRow) {
  if (!canAdmin(admin.role, "catalog.propose")) throw forbidden()
  if (isUnclaimedFounding(b) && !canAdmin(admin.role, "brands.founding")) throw forbidden(`Only Yard owners can import products for ${b.name} before it's claimed.`)
  if (b.reviewStatus === "suspended") throw rule(`${b.name} is suspended, so it can't take suggestions.`)
}

async function brandContext(d: Executor, admin: AdminActor, b: BrandRow): Promise<ImportBrandContextDto> {
  const [draft] = await d.select({ config: storefrontDrafts.config }).from(storefrontDrafts).where(eq(storefrontDrafts.brandId, b.id)).limit(1)
  const unclaimed = isUnclaimedFounding(b)
  return {
    id: b.id,
    name: b.name,
    handle: b.handle,
    currency: b.currency,
    category: b.categories[0] ?? null,
    founding: b.founding,
    claimStatus: b.claimStatus === "claimed" ? "claimed" : "unclaimed",
    goLiveOnClaim: b.goLiveOnClaim,
    canUseSiteProfile: unclaimed && canAdmin(admin.role, "brands.founding") && b.reviewStatus !== "restricted",
    has: { logo: !!b.logoMediaId, banner: typeof draft?.config?.coverMediaId === "string", story: !!b.story?.trim(), instagram: !!b.instagram, tiktok: !!b.tiktok },
  }
}

async function categories(d: Executor) {
  const rows = await d.select({ slug: catalogCategories.slug, name: catalogCategories.name, subcategories: catalogCategories.subcategories }).from(catalogCategories).orderBy(asc(catalogCategories.position))
  return rows.map((r) => ({ slug: r.slug, name: r.name, subcategories: r.subcategories ?? [] }))
}

/** What the brand already has, for the duplicate check: product names, waiting or accepted suggestions, and earlier imports. */
async function existingFor(d: Executor, brandId: string): Promise<Existing> {
  const [products, proposals, items] = await Promise.all([
    d
      .select({ title: catalogProducts.title })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.brandId, brandId), ne(catalogProducts.status, "archived"))),
    d
      .select({ title: sql<string | null>`${productProposals.payload} ->> 'title'`, status: productProposals.status })
      .from(productProposals)
      .where(and(eq(productProposals.brandId, brandId), eq(productProposals.kind, "new"), inArray(productProposals.status, ["pending", "accepted"]))),
    d
      .select({ url: catalogImportItems.sourceUrl, updatedAt: catalogImportItems.updatedAt })
      .from(catalogImportItems)
      .where(and(eq(catalogImportItems.brandId, brandId), eq(catalogImportItems.status, "created"))),
  ])
  const day = (x: Date) => x.toISOString().slice(0, 10)
  return {
    titles: [...products.map((p) => ({ title: p.title, what: `“${p.title}” in the catalogue` })), ...proposals.filter((p) => p.title).map((p) => ({ title: p.title!, what: p.status === "pending" ? `a waiting suggestion, “${p.title}”` : `an accepted suggestion, “${p.title}”` }))],
    sourceUrls: items.map((i) => ({ url: i.url, what: `suggested ${day(i.updatedAt)}` })),
  }
}

/* ---------- DTOs ---------- */

const emptyCounts = (): Record<ImportItemStatus, number> => Object.fromEntries(IMPORT_ITEM_STATUSES.map((s) => [s, 0])) as Record<ImportItemStatus, number>

async function countsFor(d: Executor, ids: string[]) {
  const out = new Map<string, Record<ImportItemStatus, number>>()
  if (!ids.length) return out
  const rows = await d
    .select({ id: catalogImportItems.importId, status: catalogImportItems.status, n: sql<number>`count(*)::int` })
    .from(catalogImportItems)
    .where(inArray(catalogImportItems.importId, ids))
    .groupBy(catalogImportItems.importId, catalogImportItems.status)
  for (const r of rows) {
    const c = out.get(r.id) ?? emptyCounts()
    c[r.status as ImportItemStatus] = Number(r.n)
    out.set(r.id, c)
  }
  return out
}

function summaryOf(r: Row, counts: Record<ImportItemStatus, number> | undefined): ImportSummaryDto {
  return {
    id: r.id,
    brandId: r.brandId,
    sourceUrl: r.sourceUrl,
    platform: (r.platform as ImportPlatform | null) ?? null,
    status: r.status as ImportStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdByName,
    products: r.found.length,
    counts: counts ?? emptyCounts(),
  }
}

const progressOf = (r: Row): ImportProgressDto => ({ phase: "start", pagesFetched: 0, productsFound: 0, productPages: 0, note: null, ...(r.progress as Partial<ImportProgressDto>) })

async function detailOf(d: Executor, admin: AdminActor, r: Row): Promise<ImportDetailDto> {
  const b = await loadBrand(d, r.brandId)
  const items = await d
    .select({ i: catalogImportItems, proposalStatus: productProposals.status })
    .from(catalogImportItems)
    .leftJoin(productProposals, eq(productProposals.id, catalogImportItems.proposalId))
    .where(eq(catalogImportItems.importId, r.id))
    .orderBy(asc(catalogImportItems.position), asc(catalogImportItems.key))
  const counts = emptyCounts()
  for (const x of items) counts[x.i.status as ImportItemStatus]++
  const profile = r.profile as ImportDetailDto["profile"]
  return {
    ...summaryOf(r, counts),
    progress: progressOf(r),
    error: r.error,
    warnings: r.warnings,
    brand: (r.brand as ImportBrandDto | null) ?? null,
    found: r.found as unknown as ImportProductDto[],
    items: items.map(({ i, proposalStatus }) => ({
      key: i.key,
      title: i.title,
      sourceUrl: i.sourceUrl,
      status: i.status as ImportItemStatus,
      reason: i.reason,
      proposalId: i.proposalId,
      proposalStatus: proposalStatus ?? null,
      images: { done: (i.mediaIds as (string | null)[]).filter(Boolean).length, total: i.imagesTotal },
      cover: ((id) => (id ? `/api/media/${encodeURIComponent(id)}?as=admin` : null))((i.mediaIds as (string | null)[]).find(Boolean)),
      updatedAt: i.updatedAt.toISOString(),
    })),
    profile: profile ?? null,
    categories: await categories(d),
    context: await brandContext(d, admin, b),
  }
}

async function loadImport(d: Executor, id: string) {
  if (!/^imp_[\w-]{1,64}$/.test(id)) throw notFound("That import doesn't exist.")
  const [r] = await d.select().from(catalogImports).where(eq(catalogImports.id, id)).limit(1)
  if (!r) throw notFound("That import doesn't exist.")
  return r
}

/* ---------- admin reads ---------- */

export async function listImports(admin: AdminActor, brandId: string): Promise<ImportListDto> {
  const d = await db()
  const b = await loadBrand(d, brandId)
  assertMayImport(admin, b)
  const rows = await d.select().from(catalogImports).where(eq(catalogImports.brandId, b.id)).orderBy(desc(catalogImports.createdAt)).limit(20)
  const counts = await countsFor(
    d,
    rows.map((r) => r.id),
  )
  return { brand: await brandContext(d, admin, b), imports: rows.map((r) => summaryOf(r, counts.get(r.id))) }
}

export async function getImport(admin: AdminActor, id: string): Promise<{ import: ImportDetailDto }> {
  const d = await db()
  const r = await loadImport(d, id)
  assertMayImport(admin, await loadBrand(d, r.brandId))
  return { import: await detailOf(d, admin, r) }
}

/* ---------- step 1: scan ---------- */

export async function startScan(admin: AdminActor, body: ImportScanBody, ipHash: string | null): Promise<{ import: ImportDetailDto }> {
  let url: URL
  try {
    url = cleanUrl(body.url)
    startUrlOf(url.toString())
  } catch (e) {
    if (e instanceof ImportUrlError) throw badRequest({ url: e.message }, e.message)
    throw e
  }
  const d0 = await db()
  const b = await loadBrand(d0, body.brandId)
  assertMayImport(admin, b)
  const perBrand = hit(`catalog.import.scan:${b.id}`, 10, 3600)
  if (!perBrand.ok) throw rateLimited(perBrand.retryAfter, `${b.name}'s site was scanned a lot this hour. Try again later.`)
  const row = await withTx(async (tx) => {
    const [running] = await tx
      .select({ id: catalogImports.id })
      .from(catalogImports)
      .where(and(eq(catalogImports.brandId, b.id), inArray(catalogImports.status, ["scanning", "importing"])))
      .limit(1)
    if (running) throw conflict(`An import for ${b.name} is still running. Wait for it to finish.`)
    const now = new Date()
    const [r] = await tx
      .insert(catalogImports)
      .values({ id: newId("imp"), brandId: b.id, sourceUrl: url.toString(), status: "scanning", consentAt: now, progress: { phase: "start" }, createdBy: admin.userId, createdByName: admin.name, createdAt: now, updatedAt: now })
      .returning()
    await writeAudit({ actor: auditActor(admin), action: "catalog.import_scan_started", target: url.hostname, subjectType: "catalog_import", subjectId: r.id, brandId: b.id, ipHash, meta: { url: url.toString(), consent: true } })
    return r
  })
  kickImports()
  return { import: await detailOf(d0, admin, row) }
}

/* ---------- step 3: import ---------- */

const profileBody = z.object({ logo: z.boolean(), banner: z.boolean(), description: z.boolean(), socials: z.boolean() })

export async function startImport(admin: AdminActor, id: string, body: ImportRunBody, ipHash: string | null): Promise<{ import: ImportDetailDto }> {
  const d0 = await db()
  const row = await withTx(async (tx) => {
    const r = await loadImport(tx, id)
    const [locked] = await tx.select().from(catalogImports).where(eq(catalogImports.id, r.id)).for("update").limit(1)
    const b = await loadBrand(tx, locked.brandId)
    assertMayImport(admin, b)
    if (locked.status === "scanning") throw conflict("The scan is still running. Wait for the products to appear.")
    if (locked.status === "importing") throw conflict("This import is already running.")
    if (locked.status === "failed") throw conflict("This scan failed. Start a new one.")
    const found = new Map((locked.found as unknown as ImportProductDto[]).map((p) => [p.key, p]))
    const cats = new Map((await categories(tx)).map((c) => [c.slug, c]))
    const fields: Record<string, string> = {}
    const keys = new Set<string>()
    body.products.forEach((c, i) => {
      if (!found.has(c.key)) fields[`products.${i}.key`] = "That product isn't in this scan."
      if (keys.has(c.key)) fields[`products.${i}.key`] = "This product is listed twice."
      keys.add(c.key)
      if (c.currency !== b.currency) fields[`products.${i}.currency`] = `${b.name} sells in ${b.currency}. Enter the price in ${b.currency}.`
      const cat = cats.get(c.categorySlug)
      if (!cat) fields[`products.${i}.categorySlug`] = "Choose one of Yard's categories."
      else if (c.subcategory && !cat.subcategories.includes(c.subcategory)) fields[`products.${i}.subcategory`] = "Choose one of this category's subcategories."
    })
    if (Object.keys(fields).length) throw badRequest(fields, "Some products need a fix before they can be imported.")
    const ctx = await brandContext(tx, admin, b)
    const wantsProfile = body.profile && (body.profile.logo || body.profile.banner || body.profile.description || body.profile.socials)
    if (wantsProfile && !ctx.canUseSiteProfile) throw forbidden(`Only an unclaimed founding brand's storefront can be filled in from its website, by a Yard owner.`)
    if (!body.products.length && !wantsProfile) throw badRequest({ products: "Tick at least one product." }, "Tick at least one product.")

    const existing = await tx.select().from(catalogImportItems).where(eq(catalogImportItems.importId, locked.id))
    const byKey = new Map(existing.map((x) => [x.key, x]))
    const now = new Date()
    const order = [...found.keys()]
    let queued = 0
    let duplicatesSkipped = 0
    for (const p of found.values()) {
      const prev = byKey.get(p.key)
      if (prev?.status === "created") continue
      const choice = body.products.find((c) => c.key === p.key)
      let status: ImportItemStatus = "queued"
      let reason: string | null = null
      if (!choice) {
        status = "skipped"
        reason = "Not ticked."
      } else if (p.duplicate && !choice.allowDuplicate) {
        status = "skipped"
        reason = `Looks like a duplicate: ${p.duplicate.reason}`
        duplicatesSkipped++
      } else queued++
      // A product left unticked again keeps its earlier outcome (a failed one stays failed with its reason).
      if (!choice && prev) continue
      const values = { importId: locked.id, key: p.key, brandId: b.id, sourceUrl: p.sourceUrl, title: choice?.title ?? p.title, choice: (choice ?? null) as Record<string, unknown> | null, status, reason, imagesTotal: Math.min(p.images.length, IMPORT_MAX_IMAGES), attempts: 0, position: order.indexOf(p.key), updatedAt: now }
      if (prev) await tx.update(catalogImportItems).set(values).where(and(eq(catalogImportItems.importId, locked.id), eq(catalogImportItems.key, p.key)))
      else await tx.insert(catalogImportItems).values(values)
    }
    const prevProfile = (locked.profile ?? null) as { applied?: boolean } | null
    const profile = wantsProfile ? { ...profileBody.parse(body.profile), applied: false, error: null } : (prevProfile ?? null)
    const [updated] = await tx
      .update(catalogImports)
      .set({ status: "importing", profile, note: body.note?.trim() || null, leaseUntil: null, attempts: 0, updatedAt: now, finishedAt: null })
      .where(eq(catalogImports.id, locked.id))
      .returning()
    await writeAudit({
      actor: auditActor(admin),
      action: "catalog.import_started",
      target: b.name,
      subjectType: "catalog_import",
      subjectId: locked.id,
      brandId: b.id,
      ipHash,
      meta: { url: locked.sourceUrl, platform: locked.platform, queued, duplicatesSkipped, profile: wantsProfile ? body.profile : null },
    })
    return updated
  })
  kickImports()
  return { import: await detailOf(d0, admin, row) }
}

/* ---------- the runner ---------- */

/** An admin as the runner acts for them: their role now (a revoked admin's import stops). */
async function jobActor(userId: string): Promise<AdminActor | null> {
  const d = await db()
  const [u] = await d.select().from(users).where(eq(users.id, userId)).limit(1)
  const [m] = await d.select().from(adminMembers).where(eq(adminMembers.userId, userId)).limit(1)
  if (!u || u.status === "suspended" || !m) return null
  const role = m.role as AdminRole
  return { kind: "admin", sessionId: "import-runner", userId: u.id, name: u.name, role, permissions: adminRolePermissions[role] ?? [], demo: u.demo }
}

async function touch(id: string, patch: Partial<typeof catalogImports.$inferInsert> = {}) {
  const d = await db()
  await d
    .update(catalogImports)
    .set({ ...patch, leaseUntil: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
    .where(eq(catalogImports.id, id))
}

async function claimNext(): Promise<Row | null> {
  const d = await db()
  const now = new Date()
  const free = or(isNull(catalogImports.leaseUntil), lt(catalogImports.leaseUntil, now))
  const [cand] = await d
    .select({ id: catalogImports.id })
    .from(catalogImports)
    .where(and(inArray(catalogImports.status, ["scanning", "importing"]), free))
    .orderBy(asc(catalogImports.createdAt))
    .limit(1)
  if (!cand) return null
  const [row] = await d
    .update(catalogImports)
    .set({ leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: sql`${catalogImports.attempts} + 1`, updatedAt: now })
    .where(and(eq(catalogImports.id, cand.id), inArray(catalogImports.status, ["scanning", "importing"]), free))
    .returning()
  return row ?? null
}

const SYSTEM = { kind: "system" as const, name: "Website import" }

function messageOf(e: unknown, fallback: string) {
  if (e instanceof FetchRefused || e instanceof ImportUrlError) return e.message
  if (e instanceof HttpError) {
    const field = e.fields ? Object.entries(e.fields)[0] : null
    return field ? `${e.message} (${field[0]}: ${field[1]})` : e.message
  }
  if (e instanceof z.ZodError) {
    const i = e.issues[0]
    return `${i.path.join(".") || "product"}: ${i.message}`
  }
  log.error("[yard] import step failed", e)
  return fallback
}

async function failImport(r: Row, message: string) {
  const d = await db()
  await d.update(catalogImports).set({ status: "failed", error: message, leaseUntil: null, updatedAt: new Date(), finishedAt: new Date() }).where(eq(catalogImports.id, r.id))
  await d
    .update(catalogImportItems)
    .set({ status: "failed", reason: message, updatedAt: new Date() })
    .where(and(eq(catalogImportItems.importId, r.id), eq(catalogImportItems.status, "queued")))
  await writeAudit({ actor: SYSTEM, action: "catalog.import_failed", target: r.sourceUrl, subjectType: "catalog_import", subjectId: r.id, brandId: r.brandId, meta: { error: message, status: r.status } })
}

async function runScan(r: Row) {
  if (r.attempts > MAX_ATTEMPTS) return failImport(r, "The scan was interrupted too many times. Start a new one.")
  const d = await db()
  const b = await loadBrand(d, r.brandId)
  const cats = await categories(d)
  const existing = await existingFor(d, b.id)
  const fetcher = siteFetcher((u, o) => safeGet(u, o))
  const state: ImportProgressDto = { phase: "start", pagesFetched: 0, productsFound: 0, productPages: 0, note: null }
  let lastWrite = 0
  let chain = Promise.resolve()
  const progress = (p: Partial<ImportProgressDto>) => {
    Object.assign(state, p, { pagesFetched: fetcher.requests() })
    if (Date.now() - lastWrite < 800) return
    lastWrite = Date.now()
    const snap = { ...state }
    chain = chain.then(() => touch(r.id, { progress: snap })).catch((e) => log.error("[yard] import progress write failed", e))
  }
  try {
    const out = await scanSite(r.sourceUrl, { fetch: fetcher, normalize: { brandCurrency: b.currency, brandCategory: b.categories[0] ?? null, categories: cats }, existing, progress })
    await chain
    await d
      .update(catalogImports)
      .set({
        status: "scanned",
        platform: out.platform,
        startUrl: out.startUrl,
        brand: out.brand as unknown as Record<string, unknown>,
        found: out.products as unknown as Record<string, unknown>[],
        warnings: out.warnings.slice(0, 50),
        progress: { ...state, phase: "done", productsFound: out.products.length, pagesFetched: fetcher.requests(), note: null },
        leaseUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(catalogImports.id, r.id))
    await writeAudit({ actor: SYSTEM, action: "catalog.import_scanned", target: new URL(out.startUrl).hostname, subjectType: "catalog_import", subjectId: r.id, brandId: r.brandId, meta: { platform: out.platform, products: out.products.length, duplicates: out.products.filter((p) => p.duplicate).length, requests: fetcher.requests() } })
  } catch (e) {
    await chain
    await failImport(r, messageOf(e, "The scan failed. Try again, or check the address."))
  }
}

/** For an ImageKit or Shopify CDN photo, the largest size Yard keeps (8000 px is the upload limit; 2000 is plenty). */
export function imageFetchUrl(raw: string) {
  try {
    const u = new URL(raw)
    if (u.hostname === "ik.imagekit.io" && !u.searchParams.has("tr")) u.searchParams.set("tr", "w-2000,c-at_max")
    else if (/(^|\.)cdn\.shopify\.com$/.test(u.hostname) || u.pathname.includes("/cdn/shop/")) u.searchParams.set("width", "2000")
    return u.toString()
  } catch {
    return raw
  }
}

/** Downloads one photo and stores it as a brand upload of `purpose`, through the upload pipeline. */
async function copyImage(admin: AdminActor, brandId: string, url: string, purpose: "social_post" | "storefront_cover") {
  const res = await safeGet(imageFetchUrl(url), { accept: "image/jpeg,image/png,image/webp;q=0.9,image/*;q=0.5", maxBytes: IMAGE_CAP })
  const target = await authorizeAdminUpload(admin, { purpose, brandId })
  const row = await ingestBytes(admin, target, res.body)
  return row.id
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function importItem(admin: AdminActor, r: Row, b: BrandRow, it: ItemRow, p: ImportProductDto | undefined) {
  const d = await db()
  // db() inside: the last write runs in the suggestion's transaction (PGlite has one connection).
  const setItem = async (patch: Partial<typeof catalogImportItems.$inferInsert>) =>
    (await db())
      .update(catalogImportItems)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(catalogImportItems.importId, it.importId), eq(catalogImportItems.key, it.key)))
  if (!p) return setItem({ status: "failed", reason: "That product isn't in this scan any more." })
  const choice: ImportChoiceBody = importChoiceBody.parse(it.choice)
  if (choice.currency !== b.currency) return setItem({ status: "failed", reason: `${b.name} sells in ${b.currency}; this price is in ${choice.currency}.` })

  // Photos, one at a time, each stored before the next (a resumed item carries on from here). null = that photo failed.
  const media = [...((it.mediaIds ?? []) as (string | null)[])]
  const urls = p.images.slice(0, IMPORT_MAX_IMAGES)
  const failures: string[] = []
  for (let i = media.length; i < urls.length; i++) {
    let id: string | null = null
    try {
      id = await copyImage(admin, b.id, urls[i], "social_post")
    } catch (e) {
      failures.push(`Photo ${i + 1}: ${messageOf(e, "couldn't be copied")}`)
    }
    media.push(id)
    await setItem({ mediaIds: media as string[] })
    await touch(r.id)
    await pause(150)
  }
  const mediaIds = media.filter((x): x is string => !!x)
  if (urls.length && !mediaIds.length) return setItem({ status: "failed", reason: failures[0] ?? "No photo could be copied." })

  const [ship] = await d.select({ min: shippingProfiles.handlingMin, max: shippingProfiles.handlingMax }).from(shippingProfiles).where(eq(shippingProfiles.brandId, b.id)).limit(1)
  const product = proposalBodyOf(p, choice, mediaIds, { defaultProcessing: ship ? [ship.min, ship.max] : [1, 3] })
  const body = adminProposalCreateBody.parse({ kind: "new", brandId: b.id, product, ...(r.note ? { note: r.note } : {}) })
  // The suggestion and the item's outcome commit together: a crash between them can't make a second suggestion.
  await withTx(async () => {
    const created = await createProposal(admin, body, null, { quiet: true, auditMeta: { importId: r.id, sourceUrl: p.sourceUrl } })
    await setItem({ status: "created", proposalId: created.proposal.id, reason: failures.length ? failures.join(" ") : null })
  })
}

async function applyProfile(admin: AdminActor, r: Row, b: BrandRow) {
  const prof = r.profile as { logo: boolean; banner: boolean; description: boolean; socials: boolean; applied?: boolean; error?: string | null } | null
  if (!prof || prof.applied) return
  const d = await db()
  const save = (patch: { applied: boolean; error: string | null }) => d.update(catalogImports).set({ profile: { ...prof, ...patch } }).where(eq(catalogImports.id, r.id))
  if (!isUnclaimedFounding(b) || !canAdmin(admin.role, "brands.founding")) return save({ applied: false, error: "Only an unclaimed founding brand's storefront can be filled in from its website." })
  const site = (r.brand ?? {}) as Partial<ImportBrandDto>
  const errors: string[] = []
  const patch: Record<string, unknown> = {}
  const tryCopy = async (url: string | null | undefined, what: string) => {
    if (!url) return null
    try {
      return await copyImage(admin, b.id, url, "storefront_cover")
    } catch (e) {
      errors.push(`${what}: ${messageOf(e, "couldn't be copied")}`)
      return null
    }
  }
  if (prof.logo) {
    const id = await tryCopy(site.logo, "Logo")
    if (id) patch.logoMediaId = id
  }
  if (prof.banner) {
    const id = await tryCopy(site.banner, "Banner")
    if (id) patch.bannerMediaId = id
  }
  if (prof.description && site.description?.trim()) patch.story = site.description.trim().slice(0, 2000)
  if (prof.socials) {
    if (site.socials?.instagram) patch.instagram = site.socials.instagram
    if (site.socials?.tiktok) patch.tiktok = site.socials.tiktok
  }
  if (Object.keys(patch).length) {
    try {
      await updateFoundingBrand(admin, b.id, foundingPatchBody.parse(patch), null)
    } catch (e) {
      errors.push(messageOf(e, "The storefront draft couldn't be updated."))
    }
  }
  await save({ applied: true, error: errors.length ? errors.join(" ") : null })
}

async function runImport(r: Row) {
  const d = await db()
  if (r.attempts > MAX_ATTEMPTS * 4) return failImport(r, "The import was interrupted too many times.")
  const admin = await jobActor(r.createdBy)
  let b: BrandRow
  try {
    b = await loadBrand(d, r.brandId)
    if (!admin) throw forbidden("The admin who started this import can't use the Control Center any more.")
    assertMayImport(admin, b)
  } catch (e) {
    return failImport(r, messageOf(e, "This import can't continue."))
  }
  const found = new Map((r.found as unknown as ImportProductDto[]).map((p) => [p.key, p]))
  const queued = await d
    .select()
    .from(catalogImportItems)
    .where(and(eq(catalogImportItems.importId, r.id), eq(catalogImportItems.status, "queued")))
    .orderBy(asc(catalogImportItems.position))
  for (const it of queued) {
    await touch(r.id, { progress: { ...(r.progress as object), phase: "images", note: `Importing “${it.title}”` } })
    if (it.attempts >= MAX_ATTEMPTS) {
      await d
        .update(catalogImportItems)
        .set({ status: "failed", reason: "Stopped after 3 tries.", updatedAt: new Date() })
        .where(and(eq(catalogImportItems.importId, r.id), eq(catalogImportItems.key, it.key)))
      continue
    }
    await d
      .update(catalogImportItems)
      .set({ attempts: it.attempts + 1 })
      .where(and(eq(catalogImportItems.importId, r.id), eq(catalogImportItems.key, it.key)))
    try {
      await importItem(admin!, r, b, it, found.get(it.key))
    } catch (e) {
      await d
        .update(catalogImportItems)
        .set({ status: "failed", reason: messageOf(e, "This product couldn't be imported."), updatedAt: new Date() })
        .where(and(eq(catalogImportItems.importId, r.id), eq(catalogImportItems.key, it.key)))
    }
  }
  await applyProfile(admin!, r, b)

  // Tell the brand once about what this run suggested (proposals not announced yet).
  const created = await d
    .select({ proposalId: catalogImportItems.proposalId })
    .from(catalogImportItems)
    .where(and(eq(catalogImportItems.importId, r.id), eq(catalogImportItems.status, "created")))
    .orderBy(asc(catalogImportItems.position))
  const [fresh] = await d.select().from(catalogImports).where(eq(catalogImports.id, r.id)).limit(1)
  const announced = new Set(((fresh.progress as { announced?: string[] }).announced ?? []) as string[])
  const toTell = created.map((c) => c.proposalId!).filter((id) => id && !announced.has(id))
  if (toTell.length) {
    try {
      await tellBrandOfImport(`${r.id}:${toTell[0]}`, b.id, toTell)
    } catch (e) {
      log.error("[yard] telling the brand about imported suggestions failed", e)
    }
  }
  const counts = (await countsFor(d, [r.id])).get(r.id) ?? emptyCounts()
  await d
    .update(catalogImports)
    .set({ status: "done", leaseUntil: null, finishedAt: new Date(), updatedAt: new Date(), progress: { ...(fresh.progress as object), phase: "done", note: null, announced: [...announced, ...toTell] } })
    .where(eq(catalogImports.id, r.id))
  await writeAudit({ actor: auditActor(admin!), action: "catalog.import_finished", target: b.name, subjectType: "catalog_import", subjectId: r.id, brandId: b.id, meta: { url: r.sourceUrl, platform: r.platform, ...counts, told: toTell.length } })
}

/** Runs claimable imports one after another (scan or import), at most `max` per call. Never overlaps in a process. */
export async function runImports(max = 5): Promise<{ ran: number }> {
  const slots = (yard.slots ??= {})
  if (slots.importsRunning) return { ran: 0 }
  slots.importsRunning = true
  let ran = 0
  try {
    for (; ran < max; ran++) {
      const r = await claimNext()
      if (!r) break
      try {
        if (r.status === "scanning") await runScan(r)
        else await runImport(r)
      } catch (e) {
        log.error(`[yard] import ${r.id} failed`, e)
        await failImport(r, "Something went wrong on Yard's side. Start a new scan.").catch(() => {})
      }
    }
  } finally {
    slots.importsRunning = false
  }
  return { ran }
}

/** Starts the runner soon (after a scan or import starts). */
export function kickImports() {
  const slots = (yard.slots ??= {})
  if (slots.importsKick) return
  slots.importsKick = setTimeout(() => {
    slots.importsKick = undefined
    void runImports().catch((e) => log.error("[yard] import runner failed", e))
  }, 200)
}
