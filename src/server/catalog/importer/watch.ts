import "server-only"
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm"
import { currencies } from "@/config/markets"
import {
  IMPORT_MAX_IMAGES,
  type AdminWatchDto,
  type ImportChoiceBody,
  type ImportPlatform,
  type ImportProductDto,
  type SiteChangeDto,
  type SitePieceDto,
  type SitePieceStatus,
  type StudioSitePiecesDto,
  type WatchDto,
  type WatchSetBody,
} from "@/lib/api/contracts/imports"
import { choiceOf, draftOf, draftProblems, splitSizes, withCurrency } from "@/lib/importer"
import { mergeBatch, onceForKey, planSuggestionBatch, runBatch, type BatchResult } from "@/lib/batch-accept"
import { canBrand } from "@/lib/permissions"
import { writeAudit } from "../../audit"
import type { AdminActor, BrandActor } from "../../auth/dal"
import { db, withTx, type Executor } from "../../db"
import { auditLog } from "../../db/schema"
import { productProposals } from "../../db/schema/catalog"
import { catalogImports, catalogSitePieces, catalogWatches } from "../../db/schema/imports"
import { shippingProfiles } from "../../db/schema/shipping"
import { conflict, forbidden, notFound, rateLimited, rule } from "../../http/errors"
import { newId } from "../../ids"
import { log } from "../../log"
import { authorizeAdminUpload, authorizeBrandUpload } from "../../media/authorize"
import { ingestBytes } from "../../media/upload"
import { notify } from "../../notify"
import { emailBrandLeads } from "../../orders/brand-email"
import { hit } from "../../security/rate-limit"
import { yard } from "../../state"
import { adminProposalCreateBody, productCreateBody } from "../contracts"
import { brandMayPublish, createProposal, tellBrandOfImport } from "../proposals"
import { createProduct, setProductStatus } from "../studio"
import { safeGet } from "./fetch"
import { proposalBodyOf, urlKey } from "./normalize"
import { claimAllPieces, claimPiece, finishPiece, releasePiece, renewClaim, savePieceMedia, skipPiece, staleClaims, type Side } from "./pieces-db"
import { scanSite, siteFetcher } from "./scan"
import { knownPieces, seedFromImports, seenCount } from "./seen"
import { assertMayImport, brandContext, categories, downloadPhoto, existingFor, jobActor, loadBrand, messageOf, type BrandRow } from "./service"
import { backoff, baselineOf, classifyScan, IN_YARD, nextAfterSuccess, pausedNote, SeenIndex, WATCH_MAX_REQUESTS, watchEveryHours, watchPerRun, type Baseline, type SiteChange } from "./watch-rules"

/**
 * Watching a brand's website for new pieces (docs/IMPORTER.md › Watching a website).
 *
 * An admin turns watching on for a brand (one website per brand, the address and platform of an
 * import). catalog.watchSites (src/server/schedulers.ts) re-scans the due ones every
 * YARD_IMPORTER_WATCH_HOURS (6), a few brands per run, through the importer's own fetcher (same
 * SSRF rules, politeness, user agent), reading only the listing, new product pages and the pages
 * of pieces already in Yard. New pieces wait in "New from your website" for either side: Yard's
 * Approve makes a Suggestion from Yard; the brand's "Add to Yard" creates and publishes the product
 * as the brand (createProduct + setProductStatus, as accepting a suggestion does). Whoever acts
 * first wins (pieces-db.ts). Photos are copied into Yard only on approval. Price changes and
 * sell-outs of pieces in Yard are only flagged.
 */

type WatchRow = typeof catalogWatches.$inferSelect
type PieceRow = typeof catalogSitePieces.$inferSelect

const WATCH_LEASE_MS = 5 * 60_000
const SYSTEM = { kind: "system" as const, name: "Website watch" }
const adminAudit = (a: AdminActor) => ({ kind: "admin" as const, id: a.userId, name: a.name, role: a.role })
const brandAudit = (a: BrandActor) => ({ kind: "brand" as const, id: a.userId, name: a.name, role: a.role })
export const STUDIO_PIECES_HREF = "/studio/products#from-website"
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "")
  } catch {
    return u
  }
}

/* ---------- DTOs ---------- */

function watchDto(w: WatchRow, now = new Date()): WatchDto {
  const run = w.lastRun as WatchDto["lastRun"]
  return {
    brandId: w.brandId,
    sourceUrl: w.sourceUrl,
    platform: w.platform as ImportPlatform,
    enabled: w.enabled,
    status: w.status as WatchDto["status"],
    pausedNote: w.pausedNote,
    failures: w.failures,
    lastError: w.lastError,
    lastScanAt: w.lastScanAt?.toISOString() ?? null,
    lastOkAt: w.lastOkAt?.toISOString() ?? null,
    nextScanAt: w.enabled && w.status === "active" ? w.nextScanAt.toISOString() : null,
    checking: !!w.leaseUntil && w.leaseUntil > now,
    lastRun: run ?? null,
    everyHours: watchEveryHours(),
  }
}

/** The price Yard would use: the site's, converted into the brand's currency when it's one of Yard's. */
function yardPrice(p: ImportProductDto, brandCurrency: string) {
  if (p.priceMinor == null) return null
  const d = withCurrency(draftOf(p, { currency: brandCurrency, category: null }, []), brandCurrency)
  return d.currency === brandCurrency && d.price ? choiceOf(p, d).priceMinor : null
}

function pieceDto(r: PieceRow, brandCurrency: string): SitePieceDto {
  const p = (r.product ?? {}) as Partial<ImportProductDto>
  const full = r.product as unknown as ImportProductDto | null
  const sizes = (p.options ?? []).find((o) => o.name === "Size")?.values.map((v) => v.value) ?? []
  return {
    id: r.id,
    title: r.title,
    sourceUrl: r.sourceUrl,
    images: (p.images ?? []).slice(0, IMPORT_MAX_IMAGES),
    priceMinor: p.priceMinor ?? null,
    currency: p.currency ?? null,
    yardPriceMinor: full ? yardPrice(full, brandCurrency) : null,
    sizes: splitSizes(sizes.join(",")),
    availability: p.availability ?? "unknown",
    description: (p.description ?? "").slice(0, 600),
    warnings: (p.warnings ?? []).slice(0, 6),
    status: r.status as SitePieceStatus,
    taken: r.status === "approving" ? ((r.decidedKind as "admin" | "brand" | null) ?? null) : null,
    firstSeenAt: r.firstSeenAt.toISOString(),
    error: r.status === "waiting" ? r.reason : null,
  }
}

function changeDto(r: PieceRow): SiteChangeDto {
  const c = r.change as SiteChange
  return { id: r.id, title: r.title, sourceUrl: r.sourceUrl, price: c.price ?? null, soldOut: !!c.soldOut, at: c.at, productId: r.productId, proposalId: r.proposalId }
}

async function waitingPieces(d: Executor, brandId: string) {
  return d
    .select()
    .from(catalogSitePieces)
    .where(and(eq(catalogSitePieces.brandId, brandId), inArray(catalogSitePieces.status, ["waiting", "approving"])))
    .orderBy(asc(catalogSitePieces.firstSeenAt), asc(catalogSitePieces.id))
    .limit(100)
}

/* ---------- admin: the watch ---------- */

async function adminBrand(admin: AdminActor, brandId: string) {
  const d = await db()
  const b = await loadBrand(d, brandId)
  assertMayImport(admin, b)
  return { d, b }
}

export async function getAdminWatch(admin: AdminActor, brandId: string): Promise<AdminWatchDto> {
  const { d, b } = await adminBrand(admin, brandId)
  const [w] = await d.select().from(catalogWatches).where(eq(catalogWatches.brandId, b.id)).limit(1)
  const pieces = await waitingPieces(d, b.id)
  // A piece imported as a suggestion: its product, once the brand accepted it.
  const changes = await d
    .select({ p: catalogSitePieces, acceptedProductId: productProposals.productId })
    .from(catalogSitePieces)
    .leftJoin(productProposals, eq(productProposals.id, catalogSitePieces.proposalId))
    .where(and(eq(catalogSitePieces.brandId, b.id), isNotNull(catalogSitePieces.change), inArray(catalogSitePieces.status, IN_YARD)))
    .orderBy(desc(catalogSitePieces.updatedAt))
    .limit(100)
  return {
    brand: await brandContext(d, admin, b),
    watch: w ? watchDto(w) : null,
    pieces: pieces.map((p) => pieceDto(p, b.currency)),
    changes: changes.map((c) => changeDto({ ...c.p, productId: c.p.productId ?? c.acceptedProductId })),
    seen: await seenCount(b.id),
  }
}

/** Turns watching on (the import's address and platform; the brand's latest scan when no import is named) or off. */
export async function setWatch(admin: AdminActor, body: WatchSetBody, ipHash: string | null): Promise<AdminWatchDto> {
  const { d, b } = await adminBrand(admin, body.brandId)
  const now = new Date()
  const [w] = await d.select().from(catalogWatches).where(eq(catalogWatches.brandId, b.id)).limit(1)
  if (!body.enabled) {
    if (w?.enabled) {
      await withTx(async (tx) => {
        await tx.update(catalogWatches).set({ enabled: false, leaseUntil: null, updatedAt: now }).where(eq(catalogWatches.brandId, b.id))
        await writeAudit({ actor: adminAudit(admin), action: "catalog.watch_stopped", target: b.name, subjectType: "brand", subjectId: b.id, brandId: b.id, ipHash, meta: { url: w.sourceUrl } })
      })
    }
    return getAdminWatch(admin, b.id)
  }
  const [imp] = await d
    .select()
    .from(catalogImports)
    .where(and(eq(catalogImports.brandId, b.id), inArray(catalogImports.status, ["scanned", "importing", "done"]), isNotNull(catalogImports.platform), body.importId ? eq(catalogImports.id, body.importId) : undefined))
    .orderBy(desc(catalogImports.createdAt))
    .limit(1)
  if (!imp?.platform) throw rule(`Scan ${b.name}'s website first, so Yard knows what to watch.`)
  const url = imp.startUrl ?? imp.sourceUrl
  // What earlier imports found is already seen: only pieces added after this are new.
  await seedFromImports(b.id)
  await withTx(async (tx) => {
    const values = { sourceUrl: url, platform: imp.platform!, enabled: true, status: "active", pausedNote: null, failures: 0, lastError: null, nextScanAt: nextAfterSuccess(now, b.id, 0), leaseUntil: null, updatedAt: now }
    await tx
      .insert(catalogWatches)
      .values({ brandId: b.id, ...values, createdBy: admin.userId, createdByName: admin.name, createdAt: now })
      .onConflictDoUpdate({ target: catalogWatches.brandId, set: values })
    await writeAudit({ actor: adminAudit(admin), action: "catalog.watch_started", target: hostOf(url), subjectType: "brand", subjectId: b.id, brandId: b.id, ipHash, meta: { url, platform: imp.platform, importId: imp.id, everyHours: watchEveryHours() } })
  })
  return getAdminWatch(admin, b.id)
}

/** Check now (and Resume a paused watch): due at once, run in the background; the page polls. */
export async function checkWatchNow(admin: AdminActor, body: { brandId: string; resume?: boolean }, ipHash: string | null): Promise<AdminWatchDto> {
  const { d, b } = await adminBrand(admin, body.brandId)
  const [w] = await d.select().from(catalogWatches).where(eq(catalogWatches.brandId, b.id)).limit(1)
  if (!w?.enabled) throw rule(`Turn on watching for ${b.name} first.`)
  if (w.leaseUntil && w.leaseUntil > new Date()) return getAdminWatch(admin, b.id)
  const r = hit(`catalog.watch.check:${b.id}`, 6, 3600)
  if (!r.ok) throw rateLimited(r.retryAfter, `${b.name}'s site was checked a lot this hour. It's checked every ${watchEveryHours()} hours anyway.`)
  const now = new Date()
  await withTx(async (tx) => {
    await tx
      .update(catalogWatches)
      .set({ nextScanAt: now, ...(w.status === "paused" || body.resume ? { status: "active", failures: 0, pausedNote: null } : {}), updatedAt: now })
      .where(eq(catalogWatches.brandId, b.id))
    await writeAudit({ actor: adminAudit(admin), action: w.status === "paused" ? "catalog.watch_resumed" : "catalog.watch_checked", target: hostOf(w.sourceUrl), subjectType: "brand", subjectId: b.id, brandId: b.id, ipHash, meta: { url: w.sourceUrl } })
  })
  // Taken now, so the answer already says "checking" (the page polls until it's done); run in the background.
  const claimed = await claimWatch(b.id, now)
  if (claimed) kickWatch(claimed)
  return getAdminWatch(admin, b.id)
}

/* ---------- the check ---------- */

async function claimWatch(brandId: string, now: Date) {
  const d = await db()
  const [w] = await d
    .update(catalogWatches)
    .set({ leaseUntil: new Date(now.getTime() + WATCH_LEASE_MS) })
    .where(and(eq(catalogWatches.brandId, brandId), eq(catalogWatches.enabled, true), eq(catalogWatches.status, "active"), or(isNull(catalogWatches.leaseUntil), lt(catalogWatches.leaseUntil, now))))
    .returning()
  return w ?? null
}

class WatchFailed extends Error {}

/** One check of one brand's site. Never throws: a failure is recorded on the watch (backoff, then pause). */
export async function runWatch(brandId: string, now = new Date(), claimed?: WatchRow): Promise<{ ran: boolean; fresh?: number; changes?: number; error?: string }> {
  const w = claimed ?? (await claimWatch(brandId, now))
  if (!w) return { ran: false }
  const d = await db()
  const runId = newId("wr")
  try {
    const b = await loadBrand(d, brandId)
    if (b.reviewStatus === "suspended") throw new WatchFailed(`${b.name} is suspended.`)
    const known = await knownPieces(b.id)
    const seen = new SeenIndex(known.map((k) => ({ ...k, status: k.status as SitePieceStatus, baseline: (k.baseline as Baseline | null) ?? null, change: (k.change as SiteChange | null) ?? null })))
    const baseline = seen.size === 0
    let skipped = 0
    const fetcher = siteFetcher((u, o) => safeGet(u, o), { maxRequests: WATCH_MAX_REQUESTS })
    const out = await scanSite(w.sourceUrl, {
      fetch: fetcher,
      normalize: { brandCurrency: b.currency, brandCategory: b.categories[0] ?? null, categories: await categories(d) },
      existing: await existingFor(d, b.id),
      platform: w.platform as ImportPlatform,
      skipPage: (u) => {
        const s = seen.skips(u)
        if (s) skipped++
        return s
      },
    })
    if (!out.products.length && !skipped) throw new WatchFailed(`No products were found on ${hostOf(w.sourceUrl)}. ${out.warnings[0] ?? ""}`.trim())
    const cls = classifyScan(out.products, seen, { baseline, now })
    let fresh = 0
    await withTx(async (tx) => {
      for (const f of cls.fresh) {
        const p = f.product
        const waiting = !f.ignoredBecause
        const [row] = await tx
          .insert(catalogSitePieces)
          .values({ id: newId("sp"), brandId: b.id, urlKey: urlKey(p.sourceUrl), sourceUrl: p.sourceUrl, sourceId: p.sourceId, title: p.title.slice(0, 200), status: waiting ? "waiting" : "ignored", origin: "watch", reason: f.ignoredBecause, product: waiting ? (p as unknown as Record<string, unknown>) : null, baseline: baselineOf(p), runId, firstSeenAt: now, lastSeenAt: now, updatedAt: now })
          .onConflictDoNothing({ target: [catalogSitePieces.brandId, catalogSitePieces.urlKey] })
          .returning({ id: catalogSitePieces.id })
        if (row && waiting) fresh++
      }
      for (const c of cls.changes) await tx.update(catalogSitePieces).set({ change: c.change, updatedAt: now }).where(eq(catalogSitePieces.id, c.id))
      if (cls.seen.length) await tx.update(catalogSitePieces).set({ lastSeenAt: now }).where(inArray(catalogSitePieces.id, cls.seen))
      const lastRun = { new: fresh, changes: cls.changes.filter((c) => c.change).length, requests: fetcher.requests(), products: out.products.length + skipped }
      await tx
        .update(catalogWatches)
        .set({ failures: 0, lastError: null, lastScanAt: now, lastOkAt: now, nextScanAt: nextAfterSuccess(now, b.id, Math.floor(now.getTime() / 3600_000)), leaseUntil: null, lastRun, updatedAt: now })
        .where(eq(catalogWatches.brandId, b.id))
      await writeAudit({ actor: SYSTEM, action: "catalog.watch_scanned", target: hostOf(w.sourceUrl), subjectType: "brand", subjectId: b.id, brandId: b.id, meta: { runId, baseline, ...lastRun, skippedPages: skipped } })
    })
    if (fresh) await tellBrandOfNewPieces(b, runId, fresh)
    return { ran: true, fresh, changes: cls.changes.length }
  } catch (e) {
    const msg = e instanceof WatchFailed ? e.message : messageOf(e, "The check failed.")
    const failures = w.failures + 1
    const next = backoff(failures, now)
    await d
      .update(catalogWatches)
      .set({ failures, lastError: msg, lastScanAt: now, nextScanAt: next.next, status: next.pause ? "paused" : "active", pausedNote: next.pause ? pausedNote(failures, msg) : null, leaseUntil: null, updatedAt: now })
      .where(eq(catalogWatches.brandId, brandId))
    await writeAudit({ actor: SYSTEM, action: next.pause ? "catalog.watch_paused" : "catalog.watch_failed", target: hostOf(w.sourceUrl), subjectType: "brand", subjectId: brandId, brandId, meta: { runId, error: msg, failures } }).catch(() => {})
    return { ran: true, error: msg }
  }
}

/** One notification and (unless the brand switched reminders off) one email per check with new pieces. */
async function tellBrandOfNewPieces(b: BrandRow, runId: string, n: number) {
  if (b.claimStatus !== "claimed") return
  try {
    await withTx(async (tx) => {
      await notify({ kind: "brand", id: b.id }, { key: `website-pieces:${runId}`, template: "website.new_for_brand", vars: { count: n }, href: STUDIO_PIECES_HREF })
      const emailed = b.nudgeEmails ? await emailBrandLeads(tx, b.id, "brand_website_pieces", { count: n }, `brand_website_pieces:${runId}`) : 0
      await writeAudit({ actor: { kind: "system" }, action: "brand_email.website_pieces", target: b.name, subjectType: "brand", subjectId: b.id, brandId: b.id, meta: { template: "brand_website_pieces", emailed, count: n, runId, optedOut: !b.nudgeEmails } })
    })
  } catch (e) {
    log.error("[yard] telling the brand about new website pieces failed", e)
  }
}

/* ---------- approving ---------- */

/** The importer's preview rules, applied with no one editing: the site's price (converted into the brand's currency), sizes and stock. */
async function choiceFor(d: Executor, b: BrandRow, p: ImportProductDto, who: Side): Promise<ImportChoiceBody> {
  const cats = await categories(d)
  if (p.currency && p.currency !== b.currency && !(p.currency in currencies)) throw rule(`The site prices this piece in ${p.currency}, which Yard can't convert. ${who === "brand" ? "Add it with Quick add instead." : "Import it from Import from website and enter the price."}`)
  const draft = withCurrency(draftOf(p, { currency: b.currency, category: b.categories[0] ?? null }, cats), b.currency)
  const problems = draftProblems(draft, { currency: b.currency, name: b.name })
  if (problems.price) throw rule(`The site doesn't show a price for this piece. ${who === "brand" ? "Add it with Quick add instead." : "Import it from Import from website and enter the price."}`)
  const first = Object.values(problems)[0]
  if (first) throw rule(first)
  return choiceOf(p, draft)
}

/** Copies the piece's photos into Yard (each stored before the next; a retry reuses what's there). */
async function copyPhotos(piece: PieceRow, side: Side, ingest: (bytes: Buffer) => Promise<string>) {
  const p = piece.product as unknown as ImportProductDto
  const urls = p.images.slice(0, IMPORT_MAX_IMAGES)
  const media = [...((piece.mediaIds ?? []) as (string | null)[])]
  const failures: string[] = []
  for (let i = media.length; i < urls.length; i++) {
    let id: string | null = null
    try {
      id = await ingest(await downloadPhoto(urls[i]))
    } catch (e) {
      failures.push(`Photo ${i + 1}: ${messageOf(e, "couldn't be copied")}`)
    }
    media.push(id)
    const d = await db()
    await savePieceMedia(d, { id: piece.id, mediaIds: media as string[] })
    await renewClaim(d, { id: piece.id, side, now: new Date() })
  }
  const ok = media.filter((x): x is string => !!x)
  if (urls.length && !ok.length) throw rule(failures[0] ?? "No photo could be copied from the site.")
  return ok
}

async function processingOf(d: Executor, brandId: string): Promise<[number, number]> {
  const [ship] = await d.select({ min: shippingProfiles.handlingMin, max: shippingProfiles.handlingMax }).from(shippingProfiles).where(eq(shippingProfiles.brandId, brandId)).limit(1)
  return ship ? [ship.min, ship.max] : [1, 3]
}

const lost = (side: Side) => conflict(side === "admin" ? "The brand got to this piece first." : "Yard got to this piece first.")

/** Yard's Approve: the piece becomes a Suggestion from Yard (createProposal), which the brand accepts (or "Go live when they claim" does). */
async function approveAsAdmin(admin: AdminActor, b: BrandRow, piece: PieceRow, opts: { quiet: boolean; ipHash: string | null }) {
  const d = await db()
  const p = piece.product as unknown as ImportProductDto | null
  if (!p) throw rule("This piece has no product details. Wait for the next check.")
  const choice = await choiceFor(d, b, p, "admin")
  const mediaIds = await copyPhotos(piece, "admin", async (bytes) => (await ingestBytes(admin, await authorizeAdminUpload(admin, { purpose: "social_post", brandId: b.id }), bytes)).id)
  const body = adminProposalCreateBody.parse({ kind: "new", brandId: b.id, product: proposalBodyOf(p, choice, mediaIds, { defaultProcessing: await processingOf(d, b.id) }), note: "New on your website, so we added it here for you." })
  return withTx(async () => {
    const created = await createProposal(admin, body, opts.ipHash, { quiet: opts.quiet, auditMeta: { sitePieceId: piece.id, sourceUrl: piece.sourceUrl } })
    const done = await finishPiece(await db(), { id: piece.id, side: "admin", now: new Date(), proposalId: created.proposal.id, baseline: baselineOf(p) })
    if (!done) throw lost("admin")
    await writeAudit({ actor: adminAudit(admin), action: "catalog.website_piece_approved", target: piece.title, subjectType: "site_piece", subjectId: piece.id, brandId: b.id, ipHash: opts.ipHash, meta: { by: "admin", proposalId: created.proposal.id, sourceUrl: piece.sourceUrl, photos: mediaIds.length } })
    return created.proposal.id
  })
}

/** The brand's Add to Yard: created and published as the brand, like accepting a suggestion (live when the brand may publish). */
async function approveAsBrand(actor: BrandActor, b: BrandRow, piece: PieceRow, ipHash: string | null) {
  const d = await db()
  const p = piece.product as unknown as ImportProductDto | null
  if (!p) throw rule("This piece has no product details yet.")
  const choice = await choiceFor(d, b, p, "brand")
  const mediaIds = await copyPhotos(piece, "brand", async (bytes) => (await ingestBytes(actor, await authorizeBrandUpload(actor, { purpose: "social_post" }), bytes)).id)
  const own = proposalBodyOf(p, choice, mediaIds, { defaultProcessing: await processingOf(d, b.id) }) as Record<string, unknown>
  delete own.stockDelta
  delete own.expectedVersion
  const body = productCreateBody.parse(own)
  return withTx(async (tx) => {
    const created = await createProduct(actor, body, ipHash)
    let published = false
    if (await brandMayPublish(tx, { id: actor.brandId, reviewStatus: actor.brand.reviewStatus }, { images: created.product.images, variants: created.product.variants.filter((v) => v.status === "active") })) {
      await setProductStatus(actor, created.product.id, { action: "publish", expectedVersion: created.product.version }, ipHash)
      published = true
    }
    const done = await finishPiece(await db(), { id: piece.id, side: "brand", now: new Date(), productId: created.product.id, baseline: baselineOf(p) })
    if (!done) throw lost("brand")
    await writeAudit({ actor: brandAudit(actor), action: "catalog.website_piece_added", target: created.product.title, subjectType: "site_piece", subjectId: piece.id, brandId: actor.brandId, ipHash, meta: { by: "brand", productId: created.product.id, published, sourceUrl: piece.sourceUrl, photos: mediaIds.length } })
    return { productId: created.product.id, published }
  })
}

async function loadPiece(d: Executor, id: string) {
  if (!/^sp_[\w-]{1,64}$/.test(id)) throw notFound("That piece isn't here.")
  const [r] = await d.select().from(catalogSitePieces).where(eq(catalogSitePieces.id, id)).limit(1)
  if (!r) throw notFound("That piece isn't here.")
  return r
}

/** Why a piece can't be taken: the other side (or this one, elsewhere) already acted. */
async function takenMessage(id: string, side: Side) {
  const d = await db()
  const [r] = await d.select().from(catalogSitePieces).where(eq(catalogSitePieces.id, id)).limit(1)
  const other = r?.decidedKind && r.decidedKind !== side
  const who = r?.decidedKind === "brand" ? "The brand" : "Yard"
  if (r?.status === "approving") return conflict(other ? `${who} is adding this piece right now.` : "This piece is being added right now.")
  if (r?.status === "approved") return conflict(other ? `${who} already added this piece.` : "This piece was already added.")
  if (r?.status === "skipped") return conflict(other ? `${who} already passed on this piece.` : "This piece was already skipped.")
  return conflict("This piece was already handled. Reload to see where it stands.")
}

/* ---------- admin actions ---------- */

export async function adminPieceAction(admin: AdminActor, id: string, action: "approve" | "skip" | "dismiss_change", ipHash: string | null): Promise<AdminWatchDto> {
  const d = await db()
  const piece = await loadPiece(d, id)
  const { b } = await adminBrand(admin, piece.brandId)
  const now = new Date()
  const who = { side: "admin" as const, userId: admin.userId, userName: admin.name }
  if (action === "dismiss_change") {
    const c = piece.change as SiteChange | null
    if (c) {
      const base = (piece.baseline ?? { priceMinor: null, currency: null, available: true }) as Baseline
      const next: Baseline = { priceMinor: c.price?.to ?? base.priceMinor, currency: c.price?.currency ?? base.currency, available: c.soldOut ? false : base.available }
      await withTx(async (tx) => {
        await tx.update(catalogSitePieces).set({ change: null, baseline: next, updatedAt: now }).where(eq(catalogSitePieces.id, piece.id))
        await writeAudit({ actor: adminAudit(admin), action: "catalog.website_change_dismissed", target: piece.title, subjectType: "site_piece", subjectId: piece.id, brandId: b.id, ipHash, meta: { change: c } })
      })
    }
    return getAdminWatch(admin, b.id)
  }
  if (action === "skip") {
    await withTx(async (tx) => {
      const r = await skipPiece(tx, { id: piece.id, brandId: b.id, now, ...who })
      if (!r) throw await takenMessage(piece.id, "admin")
      await writeAudit({ actor: adminAudit(admin), action: "catalog.website_piece_skipped", target: piece.title, subjectType: "site_piece", subjectId: piece.id, brandId: b.id, ipHash, meta: { by: "admin", sourceUrl: piece.sourceUrl } })
    })
    return getAdminWatch(admin, b.id)
  }
  const claimed = await claimPiece(d, { id: piece.id, brandId: b.id, now, ...who })
  if (!claimed) throw await takenMessage(piece.id, "admin")
  try {
    await approveAsAdmin(admin, b, claimed, { quiet: false, ipHash })
  } catch (e) {
    await releasePiece(await db(), { id: piece.id, side: "admin", now: new Date(), error: messageOf(e, "This piece couldn't be added.") })
    throw e
  }
  return getAdminWatch(admin, b.id)
}

/** Approve all: every waiting piece is taken for Yard now (so the brand can't add one twice), then added in the background. */
export async function adminApproveAll(admin: AdminActor, brandId: string, ipHash: string | null): Promise<AdminWatchDto & { taken: number }> {
  const { d, b } = await adminBrand(admin, brandId)
  const now = new Date()
  const taken = await claimAllPieces(d, { brandId: b.id, now, side: "admin", userId: admin.userId, userName: admin.name, max: 50 })
  if (taken.length) {
    await writeAudit({ actor: adminAudit(admin), action: "catalog.website_pieces_approve_all", target: b.name, subjectType: "brand", subjectId: b.id, brandId: b.id, ipHash, meta: { pieces: taken.map((t) => t.id) } })
    setTimeout(() => void approveBatch(admin, b, taken, ipHash).catch((e) => log.error("[yard] approving website pieces failed", e)), 50).unref?.()
  }
  return { ...(await getAdminWatch(admin, b.id)), taken: taken.length }
}

async function approveBatch(admin: AdminActor, b: BrandRow, pieces: PieceRow[], ipHash: string | null) {
  const made: string[] = []
  for (const piece of pieces) {
    try {
      made.push(await approveAsAdmin(admin, b, piece, { quiet: true, ipHash }))
    } catch (e) {
      await releasePiece(await db(), { id: piece.id, side: "admin", now: new Date(), error: messageOf(e, "This piece couldn't be added.") })
    }
  }
  // One notification and one email for the batch, like an import.
  if (made.length) await tellBrandOfImport(`site:${pieces[0].id}`, b.id, made).catch((e) => log.error("[yard] telling the brand about website suggestions failed", e))
}

/* ---------- Studio ---------- */

const mayAdd = (actor: BrandActor) => canBrand(actor.role, "content.publish")

export async function studioPieces(actor: BrandActor): Promise<StudioSitePiecesDto> {
  const d = await db()
  const b = await loadBrand(d, actor.brandId)
  const rows = await waitingPieces(d, b.id)
  const [w] = await d.select({ url: catalogWatches.sourceUrl }).from(catalogWatches).where(eq(catalogWatches.brandId, b.id)).limit(1)
  const items = rows.map((r) => pieceDto(r, b.currency))
  return { items, count: items.filter((i) => i.status === "waiting").length, mayAdd: mayAdd(actor), site: w ? hostOf(w.url) : null, currency: b.currency }
}

export async function studioPieceAction(actor: BrandActor, id: string, action: "add" | "skip", ipHash: string | null): Promise<StudioSitePiecesDto & { productId?: string; published?: boolean }> {
  if (!mayAdd(actor)) throw forbidden()
  const d = await db()
  const piece = await loadPiece(d, id)
  if (piece.brandId !== actor.brandId) throw notFound("That piece isn't here.")
  const b = await loadBrand(d, actor.brandId)
  const now = new Date()
  const who = { side: "brand" as const, userId: actor.userId, userName: actor.name }
  if (action === "skip") {
    await withTx(async (tx) => {
      const r = await skipPiece(tx, { id: piece.id, brandId: b.id, now, ...who })
      if (!r) throw await takenMessage(piece.id, "brand")
      await writeAudit({ actor: brandAudit(actor), action: "catalog.website_piece_skipped", target: piece.title, subjectType: "site_piece", subjectId: piece.id, brandId: b.id, ipHash, meta: { by: "brand", sourceUrl: piece.sourceUrl } })
    })
    return studioPieces(actor)
  }
  const claimed = await claimPiece(d, { id: piece.id, brandId: b.id, now, ...who })
  if (!claimed) throw await takenMessage(piece.id, "brand")
  try {
    const r = await approveAsBrand(actor, b, claimed, ipHash)
    return { ...(await studioPieces(actor)), ...r }
  } catch (e) {
    await releasePiece(await db(), { id: piece.id, side: "brand", now: new Date(), error: messageOf(e, "This piece couldn't be added.") })
    throw e
  }
}

/**
 * Add all (or the selected ones): each waiting piece through the same path as one "Add to Yard"
 * (claim first, so Yard and the brand never both add it; the first wins; photos copied; created
 * as the brand), one at a time. A piece that fails goes back to waiting with its reason. Idempotent
 * by action key (the batch's audit row keeps the result). One batch per brand at a time.
 */
export async function studioAddPiecesBatch(actor: BrandActor, body: { ids?: string[]; idempotencyKey: string }, ipHash: string | null): Promise<StudioSitePiecesDto & BatchResult & { replayed?: boolean }> {
  if (!mayAdd(actor)) throw forbidden()
  const action = "catalog.website_pieces_batch_added"
  const key = `pieces:${actor.brandId}`
  const slots = (yard.slots ??= {})
  const inflight = (slots.piecesBatch ??= new Map<string, Promise<unknown>>()) as Map<string, Promise<unknown>>
  const before = inflight.get(key)
  const mine = (async () => {
    if (before) await before.catch(() => {})
    return onceForKey<BatchResult>(
      body.idempotencyKey,
      {
        load: async (k) => {
          const [prior] = await (await db())
            .select({ meta: auditLog.meta })
            .from(auditLog)
            .where(and(eq(auditLog.brandId, actor.brandId), eq(auditLog.action, action), sql`${auditLog.meta}->>'requestKey' = ${k}`))
            .limit(1)
          const r = (prior?.meta as { result?: BatchResult } | undefined)?.result
          return r && Array.isArray(r.accepted) && Array.isArray(r.skipped) ? { accepted: r.accepted, skipped: r.skipped } : null
        },
        save: async () => {},
      },
      async () => {
        const d = await db()
        const b = await loadBrand(d, actor.brandId)
        const waiting = (await waitingPieces(d, b.id)).filter((r) => r.status === "waiting")
        const plan = planSuggestionBatch(body.ids, waiting.map((r) => ({ id: r.id, kind: "new", productId: null, baseVersion: null })), new Map())
        const skippedPlan = plan.skipped.map((x) => ({ id: x.id, reason: "Already added, passed on or being added. Reload to see where it stands." }))
        const run = await runBatch(
          plan.take,
          async (id) => {
            const claimed = await claimPiece(await db(), { id, brandId: b.id, now: new Date(), side: "brand", userId: actor.userId, userName: actor.name })
            if (!claimed) throw await takenMessage(id, "brand")
            try {
              await approveAsBrand(actor, b, claimed, ipHash)
            } catch (e) {
              await releasePiece(await db(), { id, side: "brand", now: new Date(), error: messageOf(e, "This piece couldn't be added.") })
              throw e
            }
          },
          (e) => messageOf(e, "This piece couldn't be added.").slice(0, 200),
        )
        const result = mergeBatch(skippedPlan, run)
        await writeAudit({ actor: brandAudit(actor), action, target: b.name, subjectType: "brand", subjectId: b.id, brandId: b.id, ipHash, meta: { requestKey: body.idempotencyKey, asked: body.ids?.length ?? null, result } })
        return result
      },
    )
  })()
  inflight.set(key, mine)
  try {
    const result = await mine
    return { ...(await studioPieces(actor)), ...result }
  } finally {
    if (inflight.get(key) === mine) inflight.delete(key)
  }
}

/* ---------- the scheduled job ---------- */

/** Approvals a crash interrupted: Yard's are finished as that admin; a brand's go back to waiting (one more tap). */
async function sweepClaims(now: Date) {
  const d = await db()
  for (const r of await staleClaims(d, now)) {
    if (r.decidedKind === "admin" && r.decidedBy) {
      const admin = await jobActor(r.decidedBy)
      const b = await loadBrand(d, r.brandId).catch(() => null)
      const again = admin && b ? await claimPiece(d, { id: r.id, brandId: r.brandId, now, side: "admin", userId: admin.userId, userName: admin.name }) : null
      if (admin && b && again) {
        try {
          assertMayImport(admin, b)
          await approveAsAdmin(admin, b, again, { quiet: false, ipHash: null })
        } catch (e) {
          await releasePiece(await db(), { id: r.id, side: "admin", now: new Date(), error: messageOf(e, "This piece couldn't be added.") })
        }
        continue
      }
    }
    await releasePiece(d, { id: r.id, side: (r.decidedKind as Side) ?? "brand", now, error: "Adding this piece was interrupted. Try again." })
  }
}

/**
 * catalog.watchSites (every 15 minutes): finishes interrupted approvals, then checks the due
 * watched sites, at most YARD_IMPORTER_WATCH_PER_RUN (4) brands a run, most overdue first. One
 * indexed query when nothing is due.
 */
export async function watchSites(now = new Date()): Promise<{ checked: number; fresh: number; failed: number }> {
  const slots = (yard.slots ??= {})
  if (slots.watchRunning) return { checked: 0, fresh: 0, failed: 0 }
  slots.watchRunning = true
  const out = { checked: 0, fresh: 0, failed: 0 }
  try {
    await sweepClaims(now)
    const d = await db()
    const due = await d
      .select({ brandId: catalogWatches.brandId })
      .from(catalogWatches)
      .where(and(eq(catalogWatches.enabled, true), eq(catalogWatches.status, "active"), lte(catalogWatches.nextScanAt, now), or(isNull(catalogWatches.leaseUntil), lt(catalogWatches.leaseUntil, now))))
      .orderBy(asc(catalogWatches.nextScanAt))
      .limit(watchPerRun())
    for (const w of due) {
      const r = await runWatch(w.brandId, new Date())
      if (!r.ran) continue
      out.checked++
      out.fresh += r.fresh ?? 0
      if (r.error) out.failed++
    }
    if (out.checked) log.info(`[yard] website watch: ${out.checked} sites checked, ${out.fresh} new pieces, ${out.failed} failed`)
  } finally {
    slots.watchRunning = false
  }
  return out
}

/** Check now: runs that brand's check soon, in the background. */
function kickWatch(w: WatchRow) {
  setTimeout(() => void runWatch(w.brandId, new Date(), w).catch((e) => log.error("[yard] website check failed", e)), 50).unref?.()
}
