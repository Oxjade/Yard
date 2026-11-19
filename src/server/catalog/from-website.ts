import "server-only"
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm"
import type { WebsiteCreateBody, WebsiteDuplicateDto, WebsiteScanBody, WebsiteScanDto, WebsiteSuggestionDto } from "@/lib/api/contracts/from-website"
import type { ImportBrandDto, ImportProductDto } from "@/lib/api/contracts/imports"
import { duplicateReasons, guessMarket, handleCandidates, hostLabel, planCreate, siteKey, suggestHandle } from "@/lib/from-website"
import { canAdmin } from "@/lib/permissions"
import { writeAudit } from "../audit"
import type { AdminActor } from "../auth/dal"
import { db, withTx, type Executor } from "../db"
import { brands } from "../db/schema"
import { catalogImports, catalogWatches } from "../db/schema/imports"
import { badRequest, conflict, forbidden, HttpError, notFound, rateLimited } from "../http/errors"
import { newId } from "../ids"
import { hit } from "../security/rate-limit"
import { yard } from "../state"
import { attachImport, chooseSiteImages } from "./from-website-db"
import { createFoundingBrand, foundingHandleStatus, getFoundingBrand, updateFoundingBrand } from "./founding"
import { categories, importCore, kickImports, loadImport, startImport } from "./importer/service"
import { startUrlOf } from "./importer/scan"
import { cleanUrl, ImportUrlError } from "./importer/url"
import { getAdminWatch, setWatch } from "./importer/watch"

/**
 * Create brand from website (Admin › Brands › Founding › "Create brand from website",
 * docs/IMPORTER.md › Create brand from website): paste, check, Create store. No parallel system:
 *
 *  1. Scan: the importer's own scan and runner (importer/service.ts), on a catalog_imports row
 *     with no brand yet (brand_id null, migration 0025), with the brand's consent recorded.
 *  2. Review: the scan's products plus Yard's best guesses for the brand (handle, place, currency,
 *     logo and banner from the site's images) and a warning for brands that look like the same one.
 *  3. Create store: createFoundingBrand (founding.ts, idempotent per request key), the scan
 *     attached to it, the toggles through updateFoundingBrand, the importer's startImport (the
 *     products as Suggestions from Yard, the logo and banner into the storefront draft), and
 *     setWatch. planCreate decides what's left, so a double click or a retry finishes the job
 *     instead of doubling it.
 *  4. The claim link goes through the existing claim-link endpoint and its re-auth (founding.ts).
 *
 * Owners only: the routes need brands.founding; catalog.propose is checked here, as for an import.
 */

const auditActor = (a: AdminActor) => ({ kind: "admin" as const, id: a.userId, name: a.name, role: a.role })

function assertMay(admin: AdminActor) {
  if (!canAdmin(admin.role, "brands.founding")) throw forbidden("Only Yard owners can create founding brands.")
  if (!canAdmin(admin.role, "catalog.propose")) throw forbidden("You need permission to suggest products to create a store from a website.")
}

const EMPTY_SITE: ImportBrandDto = { name: null, logo: null, banner: null, description: null, socials: { instagram: null, tiktok: null, links: [] } }

/* ---------- 1. scan ---------- */

export async function startWebsiteScan(admin: AdminActor, body: WebsiteScanBody, ipHash: string | null): Promise<WebsiteScanDto> {
  assertMay(admin)
  let url: URL
  try {
    url = cleanUrl(body.url)
    startUrlOf(url.toString())
  } catch (e) {
    if (e instanceof ImportUrlError) throw badRequest({ url: e.message }, e.message)
    throw e
  }
  const site = siteKey(startUrlOf(url.toString()).toString()) ?? url.hostname
  const perSite = hit(`catalog.import.scan:site:${site}`, 10, 3600)
  if (!perSite.ok) throw rateLimited(perSite.retryAfter, `${site} was scanned a lot this hour. Try again later.`)
  const row = await withTx(async (tx) => {
    const now = new Date()
    const [r] = await tx
      .insert(catalogImports)
      .values({ id: newId("imp"), brandId: null, sourceUrl: url.toString(), status: "scanning", consentAt: now, progress: { phase: "start" }, createdBy: admin.userId, createdByName: admin.name, createdAt: now, updatedAt: now })
      .returning()
    await writeAudit({ actor: auditActor(admin), action: "catalog.import_scan_started", target: url.hostname, subjectType: "catalog_import", subjectId: r.id, ipHash, meta: { url: url.toString(), consent: true, newFoundingBrand: true } })
    return r
  })
  kickImports()
  return scanDto(await db(), admin, row)
}

/* ---------- 2. review ---------- */

export async function getWebsiteScan(admin: AdminActor, importId: string): Promise<WebsiteScanDto> {
  assertMay(admin)
  const d = await db()
  return scanDto(d, admin, await websiteImport(d, importId))
}

/** A scan this page may show: brand-less, or attached to a founding brand (the one it created). */
async function websiteImport(d: Executor, importId: string) {
  const r = await loadImport(d, importId)
  if (r.brandId) {
    const [b] = await d.select({ founding: brands.founding }).from(brands).where(eq(brands.id, r.brandId)).limit(1)
    if (!b?.founding) throw notFound("That import doesn't exist.")
  }
  return r
}

type ImportRow = Awaited<ReturnType<typeof loadImport>>

const siteOf = (r: ImportRow) => ({ ...EMPTY_SITE, ...((r.brand ?? {}) as Partial<ImportBrandDto>) })
const startOf = (r: ImportRow) => r.startUrl ?? r.sourceUrl

/** The images the logo and banner may be chosen from: the site's own first, then product photos. */
export function siteImages(r: ImportRow) {
  const site = siteOf(r)
  const found = r.found as unknown as ImportProductDto[]
  const all = [site.logo, site.banner, ...found.flatMap((p) => p.images.slice(0, 3))].filter((x): x is string => !!x && /^https?:\/\//.test(x))
  return [...new Set(all)].slice(0, 24)
}

async function suggestionOf(d: Executor, r: ImportRow): Promise<WebsiteSuggestionDto | null> {
  if (r.status === "scanning" || (r.status === "failed" && !r.platform)) return null
  const site = siteOf(r)
  const start = startOf(r)
  const found = r.found as unknown as ImportProductDto[]
  const name = (site.name?.trim() || hostLabel(new URL(start).hostname) || "").slice(0, 40)
  // The first free handle among the suggestion and its variants (each checked as onboarding does).
  const base = suggestHandle(start, name)
  let handle = base
  let handleAvailable = false
  for (const h of handleCandidates(base)) {
    if ((await foundingHandleStatus(h)).available) {
      handle = h
      handleAvailable = true
      break
    }
  }
  const counts = new Map<string, number>()
  for (const p of found) if (p.categorySlug) counts.set(p.categorySlug, (counts.get(p.categorySlug) ?? 0) + 1)
  const known = new Set((await categories(d)).map((c) => c.slug))
  const category = [...counts.entries()].filter(([c]) => known.has(c)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const market = guessMarket({ siteUrl: start, platform: r.platform, location: site.location ?? null, productCurrencies: found.map((p) => p.currency) })
  return {
    name,
    handle,
    handleAvailable,
    category,
    city: market.city ?? "",
    country: market.country,
    currency: market.currency,
    why: market.why,
    location: site.location ?? null,
    story: (site.description ?? "").trim().slice(0, 2000),
    instagram: site.socials.instagram,
    tiktok: site.socials.tiktok,
    logo: site.logo,
    banner: site.banner,
    images: siteImages(r),
  }
}

/** Brands that look like the one about to be created: the same website, a similar handle, or the same name. */
export async function findDuplicates(d: Executor, want: { site: string | null; handle: string; name: string | null }, exceptBrandId: string | null): Promise<WebsiteDuplicateDto[]> {
  const host = siteKey(want.site)
  const h = want.handle.toLowerCase().replace(/-/g, "")
  const n = (want.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  // Brands whose imports or watch read the same site.
  const bySite = host
    ? await d
        .selectDistinct({ brandId: catalogImports.brandId })
        .from(catalogImports)
        .where(and(isNotNull(catalogImports.brandId), or(sql`lower(${catalogImports.sourceUrl}) like ${`%://${host}%`}`, sql`lower(${catalogImports.startUrl}) like ${`%://${host}%`}`, sql`lower(${catalogImports.sourceUrl}) like ${`%://www.${host}%`}`)))
        .limit(20)
    : []
  const watched = host
    ? await d
        .select({ brandId: catalogWatches.brandId, url: catalogWatches.sourceUrl })
        .from(catalogWatches)
        .where(sql`lower(${catalogWatches.sourceUrl}) like ${`%://${host}%`}`)
        .limit(20)
    : []
  const siteIds = [...new Set([...bySite.map((x) => x.brandId!), ...watched.map((w) => w.brandId)])]
  const plain = sql`replace(${brands.handle}, '-', '')`
  const rows = await d
    .select({ id: brands.id, name: brands.name, handle: brands.handle, founding: brands.founding, claimStatus: brands.claimStatus })
    .from(brands)
    .where(
      or(
        siteIds.length ? inArray(brands.id, siteIds) : undefined,
        n.length >= 3 ? sql`regexp_replace(lower(${brands.name}), '[^a-z0-9]+', '', 'g') = ${n}` : undefined,
        h.length >= 3 ? sql`${plain} = ${h}` : undefined,
        h.length >= 5 ? sql`strpos(${plain}, ${h}) > 0` : undefined,
        h.length >= 3 ? sql`(length(${plain}) >= 5 and strpos(${h}, ${plain}) > 0)` : undefined,
        h.length >= 6 ? sql`(left(${plain}, 3) = ${h.slice(0, 3)} and abs(length(${plain}) - ${h.length}) <= 1)` : undefined,
      ),
    )
    .limit(40)
  const out: WebsiteDuplicateDto[] = []
  for (const b of rows) {
    if (b.id === exceptBrandId) continue
    const reasons = duplicateReasons(want, { id: b.id, name: b.name, handle: b.handle, founding: b.founding, sites: siteIds.includes(b.id) ? [want.site!] : [] })
    if (!reasons.length) continue
    out.push({
      id: b.id,
      name: b.name,
      handle: b.handle,
      founding: b.founding,
      claimed: b.claimStatus === "claimed",
      reasons,
      href: b.founding ? `/admin/brands?tab=founding&brand=${encodeURIComponent(b.id)}` : `/admin/brands?review=${encodeURIComponent(b.id)}`,
    })
  }
  const rank = (x: WebsiteDuplicateDto) => (x.reasons.includes("site") ? 0 : x.reasons.includes("name") ? 1 : 2)
  return out.sort((a, b) => rank(a) - rank(b)).slice(0, 8)
}

async function scanDto(d: Executor, admin: AdminActor, r: ImportRow): Promise<WebsiteScanDto> {
  // Once the store exists, the guesses and the duplicate warning are history (and the page polls).
  const suggestion = r.brandId ? null : await suggestionOf(d, r)
  const site = siteOf(r)
  const duplicates = !r.brandId && r.status !== "scanning" ? await findDuplicates(d, { site: startOf(r), handle: suggestion?.handle ?? "", name: suggestion?.name ?? site.name }, null) : []
  let created: WebsiteScanDto["created"] = null
  if (r.brandId) {
    const { brand } = await getFoundingBrand(r.brandId)
    const watch = (await getAdminWatch(admin, r.brandId).catch(() => null))?.watch ?? null
    created = { brand, watch, trayHref: `/admin/brands?tab=founding&brand=${encodeURIComponent(brand.id)}` }
  }
  return { import: await importCore(d, r), suggestion, duplicates, created }
}

/* ---------- 3. create store ---------- */

/** One Create store at a time per (admin, request key) in this process; the steps below are idempotent across processes too. */
async function oneAtATime<T>(key: string, run: () => Promise<T>): Promise<T> {
  const slots = (yard.slots ??= {})
  const inflight = (slots.websiteCreate ??= new Map<string, Promise<unknown>>()) as Map<string, Promise<unknown>>
  const before = inflight.get(key)
  const mine = (async () => {
    if (before) await before.catch(() => {})
    return run()
  })()
  inflight.set(key, mine)
  try {
    return await mine
  } finally {
    if (inflight.get(key) === mine) inflight.delete(key)
  }
}

export async function createFromWebsite(admin: AdminActor, importId: string, body: WebsiteCreateBody, ipHash: string | null): Promise<{ status: 200 | 201; scan: WebsiteScanDto }> {
  assertMay(admin)
  return oneAtATime(`${admin.userId}:${body.brand.idempotencyKey}`, () => createSteps(admin, importId, body, ipHash))
}

async function createSteps(admin: AdminActor, importId: string, body: WebsiteCreateBody, ipHash: string | null): Promise<{ status: 200 | 201; scan: WebsiteScanDto }> {
  const d = await db()
  let r = await websiteImport(d, importId)
  if (r.status === "scanning") throw conflict("The scan is still running. Wait for the products to appear.")
  if (r.status === "failed" && !r.brandId) throw conflict("This scan failed. Start a new one.")

  const [mine] = await d
    .select({ id: brands.id, goLiveOnClaim: brands.goLiveOnClaim, foundingBadge: brands.foundingBadge })
    .from(brands)
    .where(and(eq(brands.createdBy, admin.userId), eq(brands.creationKey, body.brand.idempotencyKey)))
    .limit(1)
  const [watchRow] = mine ? await d.select({ enabled: catalogWatches.enabled }).from(catalogWatches).where(eq(catalogWatches.brandId, mine.id)).limit(1) : []
  const plan = planCreate(
    { brand: mine ?? null, import: { brandId: r.brandId, status: r.status }, watch: watchRow ?? null },
    { goLiveOnClaim: body.goLiveOnClaim, foundingBadge: body.foundingBadge, watch: body.watch, products: body.products.length, logo: !!body.logoUrl, banner: !!body.bannerUrl },
  )
  if (plan.conflict) throw conflict(plan.conflict)

  // Everything that could refuse the import is checked before the brand exists, so a bad product never leaves a half-made store.
  if (plan.createBrand) {
    const images = new Set(siteImages(r))
    const fields: Record<string, string> = {}
    if (body.logoUrl && !images.has(body.logoUrl)) fields.logoUrl = "Choose one of the site's images."
    if (body.bannerUrl && !images.has(body.bannerUrl)) fields.bannerUrl = "Choose one of the site's images."
    const found = new Set((r.found as unknown as ImportProductDto[]).map((p) => p.key))
    const cats = new Map((await categories(d)).map((c) => [c.slug, c]))
    const keys = new Set<string>()
    body.products.forEach((c, i) => {
      if (!found.has(c.key)) fields[`products.${i}.key`] = "That product isn't in this scan."
      if (keys.has(c.key)) fields[`products.${i}.key`] = "This product is listed twice."
      keys.add(c.key)
      if (c.currency !== body.brand.currency) fields[`products.${i}.currency`] = `${body.brand.name} sells in ${body.brand.currency}. Enter the price in ${body.brand.currency}.`
      const cat = cats.get(c.categorySlug)
      if (!cat) fields[`products.${i}.categorySlug`] = "Choose one of Yard's categories."
      else if (c.subcategory && !cat.subcategories.includes(c.subcategory)) fields[`products.${i}.subcategory`] = "Choose one of this category's subcategories."
    })
    if (Object.keys(fields).length) throw badRequest(fields, "Some details need a fix before the store can be created.")
  }

  // The brand (founding.ts replays the same request key: 200 with the brand made first).
  const made = await createFoundingBrand(admin, body.brand, ipHash)
  const brandId = made.brand.id
  const createdNow = made.status === 201

  if (plan.attach) {
    const a = await attachImport(d, { importId: r.id, brandId })
    if (!a.ok) throw conflict("This scan was already used to create another brand.")
  }
  if (Object.keys(plan.patch).length) await updateFoundingBrand(admin, brandId, plan.patch, ipHash)

  let importStarted = false
  if (plan.startImport) {
    await chooseSiteImages(d, { importId: r.id, logo: body.logoUrl, banner: body.bannerUrl })
    try {
      await startImport(admin, r.id, { products: body.products, profile: { logo: !!body.logoUrl, banner: !!body.bannerUrl, description: false, socials: false } }, ipHash)
      importStarted = true
    } catch (e) {
      // Another request with this key got there first: the import is running, which is what was asked.
      const now = await loadImport(d, r.id)
      if (!(e instanceof HttpError && e.status === 409 && (now.status === "importing" || now.status === "done"))) throw e
    }
  }
  if (plan.watch) await setWatch(admin, { brandId, enabled: true, importId: r.id }, ipHash)

  if (createdNow) {
    await writeAudit({
      actor: auditActor(admin),
      action: "founding.created_from_website",
      target: made.brand.name,
      subjectType: "brand",
      subjectId: brandId,
      brandId,
      ipHash,
      meta: { importId: r.id, url: startOf(r), platform: r.platform, products: body.products.length, logo: !!body.logoUrl, banner: !!body.bannerUrl, goLiveOnClaim: body.goLiveOnClaim, watch: body.watch, foundingBadge: body.foundingBadge, importStarted },
    })
  }
  r = await loadImport(d, r.id)
  return { status: createdNow ? 201 : 200, scan: await scanDto(d, admin, r) }
}
