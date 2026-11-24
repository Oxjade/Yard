import "server-only"
import { and, eq, inArray, lte, ne, sql } from "drizzle-orm"
import { brandPageVisibility, productPageVisibility, type VisibilityBrand } from "@/lib/page-visibility"
import { decideSubmissions, flushQueue, type Candidate, type FlushResult, type QueueRow, type QueueStore } from "@/lib/seo/indexnow"
import { absoluteUrl, publicOrigin } from "@/lib/seo/url"
import { demoSampleBrand, refusedSampleBrand } from "../catalog/sample-guard"
import { db } from "../db"
import { brands, catalogProducts, catalogVariants, indexnowUrls } from "../db/schema"
import { drops } from "../db/schema/engagement"
import { getEnv } from "../env"
import { log } from "../log"

/**
 * IndexNow for Yard (docs/SEO-AI.md). Off, with no database work at all, while INDEXNOW_KEY is unset.
 *
 * queueIndexNow() runs after a catalogue write commits (catalog/hooks.ts) or a drop opens
 * (drops/jobs.ts). It works out each affected page's address and visibility, decides what to send
 * (src/lib/seo/indexnow.ts decideSubmissions, following src/lib/page-visibility.ts) and upserts it
 * into indexnow_urls, which dedupes. flushIndexNow() (every 5 minutes, schedulers.ts) sends what is
 * pending. Cost: the API is free; at most 3 requests per flush, nothing when the queue is empty.
 */
export type IndexNowChange = {
  /** Products whose page may have changed (published, unpublished, edited, hidden, stock to or from zero). */
  products?: string[]
  /** Brands whose storefront may have changed (published, edited, restricted). A brand that isn't public takes its pieces with it. */
  brands?: string[]
  /** Brands whose every non-archived product page changed with the brand (a launch, a restriction). */
  brandProducts?: string[]
  /** Drops that just opened (their page and their pieces' pages change). */
  drops?: string[]
}

export const indexNowOn = () => getEnv().seo.indexNowKey !== null

const CHUNK = 1000
const chunks = <T,>(list: T[]) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK))

type BrandRow = { id: string; handle: string; founding: boolean; launchedAt: Date | null; reviewStatus: string }
const visBrand = (b: BrandRow): VisibilityBrand => ({ founding: b.founding, launchedAt: b.launchedAt, reviewStatus: b.reviewStatus, sample: refusedSampleBrand(b.id), demoSample: demoSampleBrand(b.id) })
/** Was this brand ever public? Ordinary brands from the start; founding brands once launched; samples never. */
const brandEverPublic = (b: BrandRow) => !refusedSampleBrand(b.id) && (!b.founding || b.launchedAt !== null)
const brandCols = { id: brands.id, handle: brands.handle, founding: brands.founding, launchedAt: brands.launchedAt, reviewStatus: brands.reviewStatus }

/** Of these products, the ones with nothing left to buy (every variant at zero available). */
export async function productsAtZero(productIds: string[]): Promise<string[]> {
  if (!productIds.length) return []
  const d = await db()
  const out: string[] = []
  for (const ids of chunks([...new Set(productIds)])) {
    const rows = await d
      .select({ productId: catalogVariants.productId, available: sql<number>`coalesce(sum(case when ${catalogVariants.trackStock} then greatest(${catalogVariants.onHand} - ${catalogVariants.held}, 0) else 1 end), 0)::int` })
      .from(catalogVariants)
      .where(inArray(catalogVariants.productId, ids))
      .groupBy(catalogVariants.productId)
    for (const r of rows) if (Number(r.available) <= 0) out.push(r.productId)
  }
  return out
}

/** The candidates (address, visibility, ever public) for a change. Exported for the demo and tests on a database. */
export async function indexNowCandidates(change: IndexNowChange, base = publicOrigin()): Promise<Candidate[]> {
  const d = await db()
  const out: Candidate[] = []
  const now = new Date()
  const productIds = new Set(change.products ?? [])
  const brandProducts = new Set(change.brandProducts ?? [])
  for (const ids of chunks([...new Set([...(change.brands ?? []), ...brandProducts])])) {
    for (const b of await d.select(brandCols).from(brands).where(inArray(brands.id, ids))) {
      const visibility = brandPageVisibility(visBrand(b))
      out.push({ url: absoluteUrl(base, `/brands/${encodeURIComponent(b.handle)}`), visibility, everPublic: brandEverPublic(b) })
      // A brand that isn't public (restricted, suspended): its pieces' pages went with it.
      if (visibility !== "public") brandProducts.add(b.id)
    }
  }
  const dropIds = [...new Set(change.drops ?? [])]
  const dropById = new Map<string, { slug: string; status: string; brand: BrandRow }>()
  for (const ids of chunks(dropIds)) {
    const rows = await d.select({ id: drops.id, slug: drops.slug, status: drops.status, brand: brandCols }).from(drops).innerJoin(brands, eq(brands.id, drops.brandId)).where(inArray(drops.id, ids))
    for (const r of rows) dropById.set(r.id, r)
  }
  for (const [, drop] of dropById) {
    const vis = drop.status === "draft" || drop.status === "cancelled" ? "none" : brandPageVisibility(visBrand(drop.brand)) === "public" ? "public" : "none"
    out.push({ url: absoluteUrl(base, `/drops/${encodeURIComponent(drop.slug)}`), visibility: vis, everPublic: drop.status !== "draft" && brandEverPublic(drop.brand) })
  }
  const productCols = { id: catalogProducts.id, slug: catalogProducts.slug, status: catalogProducts.status, publishAt: catalogProducts.publishAt, publishedAt: catalogProducts.publishedAt, moderationStatus: catalogProducts.moderationStatus, brand: brandCols }
  const products: { id: string; slug: string; status: string; publishAt: Date | null; publishedAt: Date | null; moderationStatus: string; brand: BrandRow }[] = []
  for (const ids of chunks([...productIds])) {
    products.push(...(await d.select(productCols).from(catalogProducts).innerJoin(brands, eq(brands.id, catalogProducts.brandId)).where(inArray(catalogProducts.id, ids))))
  }
  // A brand-level change or an opening drop: the brand's (or drop's) pieces, archived ones aside.
  const wide = [
    ...chunks([...brandProducts]).map((ids) => inArray(catalogProducts.brandId, ids)),
    ...chunks([...dropById.keys()]).map((ids) => inArray(catalogProducts.dropId, ids)),
  ]
  for (const w of wide) {
    const rows = await d.select(productCols).from(catalogProducts).innerJoin(brands, eq(brands.id, catalogProducts.brandId)).where(and(w, ne(catalogProducts.status, "archived")))
    for (const r of rows) {
      if (productIds.has(r.id)) continue
      productIds.add(r.id)
      products.push(r)
    }
  }
  for (const p of products) {
    out.push({
      url: absoluteUrl(base, `/products/${encodeURIComponent(p.slug)}`),
      visibility: productPageVisibility(p, visBrand(p.brand), now),
      everPublic: p.publishedAt !== null && brandEverPublic(p.brand),
    })
  }
  return out
}

/** Queues the public pages a change touched (and pages that just stopped being public). No-op while IndexNow is off. */
export async function queueIndexNow(change: IndexNowChange): Promise<{ queued: { url: string; live: boolean }[] }> {
  if (!indexNowOn()) return { queued: [] }
  return queueIndexNowCandidates(await indexNowCandidates(change))
}

/**
 * Queues candidates worked out earlier. For pages whose rows are about to go (Admin › Brands ›
 * Delete brand): the caller reads indexNowCandidates before the delete, marks them "none" and
 * queues them after commit, when nothing is left to read them from.
 */
export async function queueIndexNowCandidates(candidates: Candidate[]): Promise<{ queued: { url: string; live: boolean }[] }> {
  if (!indexNowOn() || !candidates.length) return { queued: [] }
  const d = await db()
  const known = new Map<string, boolean>()
  for (const urls of chunks([...new Set(candidates.map((c) => c.url))])) {
    for (const r of await d.select({ url: indexnowUrls.url, live: indexnowUrls.live }).from(indexnowUrls).where(inArray(indexnowUrls.url, urls))) known.set(r.url, r.live)
  }
  const queued = decideSubmissions(candidates, known)
  const now = new Date()
  for (const rows of chunks(queued)) {
    await d
      .insert(indexnowUrls)
      .values(rows.map((r) => ({ url: r.url, live: r.live, pending: true, queuedAt: now, attempts: 0, nextAttemptAt: now, lastError: null })))
      .onConflictDoUpdate({
        target: indexnowUrls.url,
        set: { live: sql`excluded.live`, pending: true, queuedAt: now, attempts: 0, nextAttemptAt: now, lastError: null },
      })
  }
  return { queued }
}

/** queueIndexNow for after-commit hooks: never throws, logs a failure. */
export function queueIndexNowSafely(change: IndexNowChange) {
  if (!indexNowOn()) return Promise.resolve()
  return queueIndexNow(change).then(
    () => undefined,
    (e: unknown) => log.error("[yard] indexnow: queueing failed", e),
  )
}

const store: QueueStore = {
  async due(now, limit) {
    const d = await db()
    return d
      .select({ url: indexnowUrls.url, attempts: indexnowUrls.attempts })
      .from(indexnowUrls)
      .where(and(eq(indexnowUrls.pending, true), lte(indexnowUrls.nextAttemptAt, now)))
      .orderBy(indexnowUrls.queuedAt)
      .limit(limit)
  },
  async sent(urls, now) {
    const d = await db()
    for (const ids of chunks(urls)) await d.update(indexnowUrls).set({ pending: false, sentAt: now, attempts: 0, lastError: null }).where(inArray(indexnowUrls.url, ids))
  },
  async retry(rows: QueueRow[], retryAt, error) {
    const d = await db()
    // Rows sharing an attempt count share a retry time: one update per group.
    const byAttempts = new Map<number, string[]>()
    for (const r of rows) byAttempts.set(r.attempts + 1, [...(byAttempts.get(r.attempts + 1) ?? []), r.url])
    for (const [attempts, urls] of byAttempts) {
      for (const ids of chunks(urls)) await d.update(indexnowUrls).set({ attempts, nextAttemptAt: retryAt(attempts), lastError: error.slice(0, 500) }).where(inArray(indexnowUrls.url, ids))
    }
  },
  async dropped(urls, error) {
    const d = await db()
    for (const ids of chunks(urls)) await d.update(indexnowUrls).set({ pending: false, lastError: error.slice(0, 500) }).where(inArray(indexnowUrls.url, ids))
  },
}

/** Job (every 5 minutes): sends pending URLs. Nothing at all while IndexNow is off. */
export async function flushIndexNow(fetchImpl: typeof fetch = fetch): Promise<FlushResult | null> {
  const env = getEnv()
  const key = env.seo.indexNowKey
  if (!key) return null
  return flushQueue(store, { key, origin: publicOrigin(), endpoint: env.seo.indexNowEndpoint, fetch: fetchImpl, log: (line) => log.info(line) })
}

