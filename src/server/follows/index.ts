import "server-only"
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { currencies, type CurrencyCode } from "@/config/markets"
import { productById } from "@/lib/data/products"
import { formatMoney } from "@/lib/money"
import type { ShopperActor } from "../auth/dal"
import { db, withTx, type Executor } from "../db"
import { brands, shopperFollows, shopperWishlist, users } from "../db/schema"
import { backInStockRequests, productWatchState, searchProducts } from "../db/schema/engagement"
import { enqueueEmail } from "../email"
import { inAppPref, notifyEngagement } from "../email/inapp"
import { getPreferencesMany } from "../email/preferences"
import { badRequest, conflict, notFound } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { indexedProducts } from "../search"
import { catalogProducts, catalogVariants } from "../db/schema/catalog"
import { productPublicWhere } from "../catalog/sellable"
import { refuseSampleBrand, refuseSampleProduct, refuseSampleVariant, refusedSampleBrand, refusedSampleProduct, sampleOff } from "../catalog/sample-guard"
import { hasLiveCatalog, sampleProductDoc, sellableVariants } from "../search/catalog-port"
import { hmacHex } from "../security/crypto"
import { keys } from "../security/keys"
import { accountAgeDays, ingestSignal, type SignalActor, type SignalVerdict } from "../signals"

/**
 * Follows, wishlist and back-in-stock (ENGAGEMENT v3). State lives in the existing
 * shopper_follows / shopper_wishlist tables, written through signals ingest whenever the target is
 * in the sample catalogue, so chart events and charts keep working exactly as before. Products
 * created in Studio (not in the sample catalogue) are validated through the search index and
 * written directly (no chart event, since ingest can't resolve them yet).
 */
export const IMPL: string = "ENGAGEMENT-v3-2026-11-08"

export type RequestMeta = { ipHash: string | null; userAgent: string | null }

export function signalActorFor(shopper: ShopperActor, meta: RequestMeta): SignalActor {
  const uaHash = meta.userAgent ? hmacHex(keys().anon, meta.userAgent).slice(0, 16) : null
  return { actorKind: "shopper", actorId: shopper.userId, ipHash: meta.ipHash, uaHash, accountAgeDays: accountAgeDays(shopper.createdAt), status: shopper.status }
}

/* ---------- Follows ---------- */

/** Public follower counts: the brand's baseline plus real follows. */
export async function followerCounts(brandIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(brandIds)].filter((id) => !refusedSampleBrand(id)).slice(0, 100)
  if (!ids.length) return {}
  const d = await db()
  const [base, real] = await Promise.all([
    d.select({ id: brands.id, base: brands.followersBase }).from(brands).where(inArray(brands.id, ids)),
    d.select({ id: shopperFollows.brandId, n: count() }).from(shopperFollows).where(inArray(shopperFollows.brandId, ids)).groupBy(shopperFollows.brandId),
  ])
  const realBy = new Map(real.map((r) => [r.id, r.n]))
  return Object.fromEntries(base.map((b) => [b.id, b.base + (realBy.get(b.id) ?? 0)]))
}

export async function followerCount(brandId: string) {
  return (await followerCounts([brandId]))[brandId] ?? 0
}

/** When the user started following the brand, or null. */
export async function followedSince(userId: string, brandId: string): Promise<Date | null> {
  const d = await db()
  const [row] = await d.select({ at: shopperFollows.createdAt }).from(shopperFollows).where(and(eq(shopperFollows.userId, userId), eq(shopperFollows.brandId, brandId))).limit(1)
  return row?.at ?? null
}

export async function listFollows(userId: string) {
  const d = await db()
  const rows = await d
    .select({ brandId: shopperFollows.brandId, followedAt: shopperFollows.createdAt, handle: brands.handle, name: brands.name, city: brands.city, country: brands.country, verified: brands.verified, reviewStatus: brands.reviewStatus })
    .from(shopperFollows)
    .innerJoin(brands, eq(brands.id, shopperFollows.brandId))
    .where(eq(shopperFollows.userId, userId))
    .orderBy(desc(shopperFollows.createdAt))
  const visible = rows.filter((r) => r.reviewStatus !== "suspended" && !refusedSampleBrand(r.brandId))
  const counts = await followerCounts(visible.map((r) => r.brandId))
  return visible.map(({ reviewStatus: _r, ...r }) => ({ ...r, followedAt: r.followedAt.toISOString(), followers: counts[r.brandId] ?? 0 }))
}

async function assertBrand(brandId: string) {
  // Production: a sample brand is refused by identity (404), whatever the database holds.
  refuseSampleBrand(brandId)
  const d = await db()
  const [b] = await d.select({ id: brands.id, reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!b || b.reviewStatus === "suspended") throw notFound("We couldn't find that brand.")
}

export async function followBrand(shopper: ShopperActor, brandId: string, meta: RequestMeta) {
  await assertBrand(brandId)
  const verdict = await ingestSignal({ kind: "follow", brandId }, signalActorFor(shopper, meta))
  return { brandId, following: true, followers: await followerCount(brandId), verdict }
}

export async function unfollowBrand(shopper: ShopperActor, brandId: string, meta: RequestMeta) {
  await assertBrand(brandId)
  const verdict = await ingestSignal({ kind: "unfollow", brandId }, signalActorFor(shopper, meta))
  return { brandId, following: false, followers: await followerCount(brandId), verdict }
}

/* ---------- Wishlist ---------- */

/** A product's brand and variants: the sample catalogue first (ingest can count it), else the search index. */
async function resolveProduct(productId: string): Promise<{ productId: string; brandId: string; sample: boolean; variantIds: string[] } | null> {
  // Production: a sample piece is refused by identity (404); demo resolves it from the sample catalogue.
  refuseSampleProduct(productId)
  const sample = sampleOff() ? undefined : productById.get(productId)
  if (sample) return { productId, brandId: sample.brandId, sample: true, variantIds: sample.variants.map((v) => v.id) }
  const [row] = await indexedProducts([productId])
  if (row && row.visible) return { productId, brandId: row.brandId, sample: false, variantIds: row.variantIds }
  // Not in the search index yet (or the index is behind): the public catalogue itself.
  if (!row) {
    const d = await db()
    const [p] = await d
      .select({ brandId: catalogProducts.brandId })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(and(eq(catalogProducts.id, productId), productPublicWhere()))
      .limit(1)
    if (p) {
      const vs = await d.select({ id: catalogVariants.id }).from(catalogVariants).where(eq(catalogVariants.productId, productId))
      return { productId, brandId: p.brandId, sample: false, variantIds: vs.map((v) => v.id) }
    }
  }
  return null
}

export async function addToWishlist(shopper: ShopperActor, productId: string, meta: RequestMeta) {
  const p = await resolveProduct(productId)
  if (!p) throw notFound("We couldn't find that piece.")
  let verdict: SignalVerdict | "direct" = "direct"
  if (p.sample) verdict = await ingestSignal({ kind: "wishlist_add", productId }, signalActorFor(shopper, meta))
  else await withTx(async (tx) => tx.insert(shopperWishlist).values({ userId: shopper.userId, productId, brandId: p.brandId }).onConflictDoNothing())
  return { productId, saved: true, verdict }
}

export async function removeFromWishlist(shopper: ShopperActor, productId: string, meta: RequestMeta) {
  let verdict: SignalVerdict | "direct" = "direct"
  if (!sampleOff() && productById.has(productId)) verdict = await ingestSignal({ kind: "wishlist_remove", productId }, signalActorFor(shopper, meta))
  else await withTx(async (tx) => tx.delete(shopperWishlist).where(and(eq(shopperWishlist.userId, shopper.userId), eq(shopperWishlist.productId, productId))))
  return { productId, saved: false, verdict }
}

/** The shopper's wishlist with product details from the search index (or the sample catalogue) and live price/stock when CATALOG is loaded. */
export async function listWishlist(userId: string) {
  const d = await db()
  const all = await d.select().from(shopperWishlist).where(eq(shopperWishlist.userId, userId)).orderBy(desc(shopperWishlist.createdAt)).limit(500)
  // Production: saved sample pieces are dropped from the list and from the account.
  const gone = all.filter((r) => refusedSampleProduct(r.productId) || refusedSampleBrand(r.brandId)).map((r) => r.productId)
  if (gone.length) await d.delete(shopperWishlist).where(and(eq(shopperWishlist.userId, userId), inArray(shopperWishlist.productId, gone)))
  const rows = gone.length ? all.filter((r) => !gone.includes(r.productId)) : all
  const sampleDoc = (id: string) => (sampleOff() ? null : sampleProductDoc(id))
  const ids = rows.map((r) => r.productId)
  const indexed = new Map((await indexedProducts(ids)).map((r) => [r.productId, r]))
  const variantIds = ids.flatMap((id) => indexed.get(id)?.variantIds ?? sampleDoc(id)?.variantIds ?? [])
  const live = await sellableVariants(variantIds).catch(() => [])
  const liveBy = new Map<string, { minPriceMinor: number; currency: string; available: number }>()
  for (const v of live) {
    const cur = liveBy.get(v.productId)
    if (!cur) liveBy.set(v.productId, { minPriceMinor: v.priceMinor, currency: v.currency, available: v.available })
    else liveBy.set(v.productId, { minPriceMinor: Math.min(cur.minPriceMinor, v.priceMinor), currency: cur.currency, available: cur.available + v.available })
  }
  const pending = await d
    .select({ variantId: backInStockRequests.variantId, productId: backInStockRequests.productId })
    .from(backInStockRequests)
    .where(and(eq(backInStockRequests.userId, userId), isNull(backInStockRequests.notifiedAt)))
  return rows.map((r) => {
    const ix = indexed.get(r.productId)
    const sample = ix ? null : sampleDoc(r.productId)
    const l = liveBy.get(r.productId)
    return {
      productId: r.productId,
      brandId: r.brandId,
      savedAt: r.createdAt.toISOString(),
      title: ix?.title ?? sample?.title ?? null,
      slug: ix?.slug ?? sample?.slug ?? null,
      brandName: ix?.brandName ?? null,
      available: l?.available ?? ix?.available ?? sample?.available ?? null,
      price: l ? { amount: l.minPriceMinor, currency: l.currency } : ix ? { amount: ix.priceMinor, currency: ix.currency } : sample ? { amount: sample.priceMinor, currency: sample.currency } : null,
      /** False when the product was unpublished or hidden since it was saved. */
      listed: ix ? ix.visible : !!sample?.visible,
      backInStockVariantIds: pending.filter((p) => p.productId === r.productId).map((p) => p.variantId),
    }
  })
}

/**
 * Merges a browser's saved lists (from before sign-in) into the account: follows, wishlist and
 * drop reminders not already saved. Unknown ids are skipped and reported. Each goes through the
 * same path as a single toggle, so charts count only real changes.
 */
export async function mergeSaved(shopper: ShopperActor, input: { brandIds: string[]; productIds: string[] }, meta: RequestMeta) {
  const d = await db()
  const [haveBrands, haveProducts] = await Promise.all([
    d.select({ id: shopperFollows.brandId }).from(shopperFollows).where(eq(shopperFollows.userId, shopper.userId)),
    d.select({ id: shopperWishlist.productId }).from(shopperWishlist).where(eq(shopperWishlist.userId, shopper.userId)),
  ])
  const hb = new Set(haveBrands.map((r) => r.id))
  const hp = new Set(haveProducts.map((r) => r.id))
  const skipped: string[] = []
  let followed = 0
  let saved = 0
  for (const brandId of [...new Set(input.brandIds)]) {
    if (hb.has(brandId)) continue
    if (refusedSampleBrand(brandId)) {
      skipped.push(brandId)
      continue
    }
    try {
      await followBrand(shopper, brandId, meta)
      followed++
    } catch {
      skipped.push(brandId)
    }
  }
  for (const productId of [...new Set(input.productIds)]) {
    if (hp.has(productId)) continue
    if (refusedSampleProduct(productId)) {
      skipped.push(productId)
      continue
    }
    try {
      await addToWishlist(shopper, productId, meta)
      saved++
    } catch {
      skipped.push(productId)
    }
  }
  return { followed, saved, skipped }
}

/* ---------- Back in stock ---------- */

/** The product a variant belongs to and its live availability (CATALOG), falling back to the index. */
async function variantInfo(variantId: string): Promise<{ productId: string; brandId: string; available: number | null; label: string | null; title: string | null } | null> {
  // Production: a sample size or colour is refused by identity (404).
  refuseSampleVariant(variantId)
  if (await hasLiveCatalog()) {
    const [live] = await sellableVariants([variantId])
    return live ? { productId: live.productId, brandId: live.brandId, available: live.available, label: live.variantLabel, title: live.title } : null
  }
  for (const p of sampleOff() ? [] : productById.values()) {
    if (!sampleProductDoc(p.id)?.visible) continue
    const v = p.variants.find((x) => x.id === variantId)
    if (v) return { productId: p.id, brandId: p.brandId, available: Math.max(0, v.stock - v.reserved), label: Object.values(v.options).join(" / "), title: p.name }
  }
  const d = await db()
  const [row] = await d
    .select({ productId: searchProducts.productId, brandId: searchProducts.brandId, title: searchProducts.title })
    .from(searchProducts)
    .where(and(eq(searchProducts.visible, true), sql`${searchProducts.variantIds} @> array[${variantId}]::text[]`))
    .limit(1)
  if (row) return { ...row, available: null, label: null }
  return null
}

export async function requestBackInStock(userId: string, variantId: string) {
  const info = await variantInfo(variantId)
  if (!info) throw notFound("We couldn't find that size or colour.")
  if (info.available != null && info.available > 0) throw conflict("This one is in stock now.")
  await withTx(async (tx) => {
    const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update").limit(1)
    if (!account) throw notFound()
    const [existing] = await tx
      .select({ notifiedAt: backInStockRequests.notifiedAt })
      .from(backInStockRequests)
      .where(and(eq(backInStockRequests.userId, userId), eq(backInStockRequests.variantId, variantId)))
      .for("update")
      .limit(1)
    if (existing && existing.notifiedAt === null) return
    const [pending] = await tx
      .select({ n: count() })
      .from(backInStockRequests)
      .where(and(eq(backInStockRequests.userId, userId), isNull(backInStockRequests.notifiedAt)))
    if ((pending?.n ?? 0) >= 100) throw badRequest({ variantId: "You're watching 100 pieces already. Remove one first." })
    await tx
      .insert(backInStockRequests)
      .values({ id: newId("bis"), userId, productId: info.productId, variantId })
      .onConflictDoUpdate({ target: [backInStockRequests.userId, backInStockRequests.variantId], set: { notifiedAt: null, createdAt: new Date() } })
  })
  return { variantId, productId: info.productId, watching: true }
}

/** Whether the shopper is waiting on this size/colour (any product, saved or not). */
export async function backInStockStatus(userId: string, variantId: string) {
  const d = await db()
  const [row] = await d
    .select({ id: backInStockRequests.id })
    .from(backInStockRequests)
    .where(and(eq(backInStockRequests.userId, userId), eq(backInStockRequests.variantId, variantId), isNull(backInStockRequests.notifiedAt)))
    .limit(1)
  return { variantId, watching: !!row }
}

export async function cancelBackInStock(userId: string, variantId: string) {
  await withTx(async (tx) => tx.delete(backInStockRequests).where(and(eq(backInStockRequests.userId, userId), eq(backInStockRequests.variantId, variantId))))
  return { variantId, watching: false }
}

/* ---------- Watch job: price drops and restocks ---------- */

const money = (amount: number, currency: string) => (currency in currencies ? formatMoney(amount, currency as CurrencyCode) : `${amount} ${currency}`)

type Watcher = { userId: string; email: string; name: string }

async function watchersOf(userIds: string[]): Promise<Map<string, Watcher>> {
  if (!userIds.length) return new Map()
  const d = await db()
  const rows = await d.select({ id: users.id, email: users.email, name: users.name, status: users.status }).from(users).where(inArray(users.id, userIds))
  return new Map(rows.filter((r) => r.status !== "suspended").map((r) => [r.id, { userId: r.id, email: r.email, name: r.name }]))
}

/** Tells one user about a price drop or restock: in-app (if their preference allows) and email (enqueueEmail applies preferences). */
async function tell(w: Watcher, kind: "price_drop" | "back_in_stock", p: { productId: string; title: string; slug: string | null; brandName: string | null; price?: string; was?: string; variant?: string | null; image?: string | null }, dedupe: string, inApp: boolean) {
  const href = p.slug ? `/products/${p.slug}` : "/wishlist"
  if (inApp) {
    await notifyEngagement(
      { kind: "shopper", id: w.userId },
      kind === "price_drop"
        ? { key: `price_drop:${p.productId}`, template: "wishlist.price_drop", vars: { product: p.title, price: p.price, was: p.was }, href }
        : { key: `back_in_stock:${p.productId}`, template: "wishlist.back_in_stock", vars: { product: p.title, brand: p.brandName ?? undefined }, href },
    )
  }
  const d = await db()
  await enqueueEmail(d, {
    template: kind,
    to: w.email,
    dedupeKey: `${kind}:${dedupe}:${w.userId}`,
    vars: { ...(kind === "price_drop" ? { name: w.name, product: p.title, brand: p.brandName ?? "", price: p.price ?? "", was: p.was ?? "", url: href } : { name: w.name, product: p.title, brand: p.brandName ?? "", variant: p.variant ?? "", url: href }), ...(p.image ? { image: p.image } : {}) },
  })
}

/**
 * Hourly. Compares live prices and stock (CATALOG getSellableVariants) for every wishlisted
 * product with the last snapshot: a drop of at least 1% notifies its wishlisters; a product going
 * from sold out to available notifies them as back in stock. Then serves variant-level
 * back-in-stock requests. Skips (and says so) while CATALOG isn't loaded: the sample catalogue
 * never changes, so it can't produce a real alert.
 */
export async function watchPrices() {
  const d = await db()
  const wished = await d.selectDistinct({ productId: shopperWishlist.productId }).from(shopperWishlist).limit(5000)
  const pendingBis = await d.select().from(backInStockRequests).where(isNull(backInStockRequests.notifiedAt)).limit(5000)
  const productIds = [...new Set(wished.map((r) => r.productId))]
  const indexed = new Map((await indexedProducts(productIds)).map((r) => [r.productId, r]))
  const variantIds = [...new Set([...productIds.flatMap((id) => indexed.get(id)?.variantIds ?? (sampleOff() ? null : sampleProductDoc(id))?.variantIds ?? []), ...pendingBis.map((r) => r.variantId)])]
  const live = await sellableVariants(variantIds)
  if (variantIds.length && !live.length) {
    log.once("engagement:watch-no-catalog", "info", "[yard] price/stock watch skipped: CATALOG getSellableVariants returned nothing (not loaded yet?)")
    return { priceDrops: 0, restocks: 0, variantRestocks: 0 }
  }
  const byProduct = new Map<string, { min: number; currency: string; available: number; title: string }>()
  const byVariant = new Map(live.map((v) => [v.variantId, v]))
  for (const v of live) {
    const cur = byProduct.get(v.productId)
    if (!cur) byProduct.set(v.productId, { min: v.priceMinor, currency: v.currency, available: v.available, title: v.title })
    else byProduct.set(v.productId, { min: Math.min(cur.min, v.priceMinor), currency: cur.currency, available: cur.available + v.available, title: cur.title })
  }
  const states = new Map((await d.select().from(productWatchState).where(inArray(productWatchState.productId, [...byProduct.keys()].length ? [...byProduct.keys()] : ["-"]))).map((s) => [s.productId, s]))

  let priceDrops = 0
  let restocks = 0
  let variantRestocks = 0
  for (const [productId, now] of byProduct) {
    if (!productIds.includes(productId)) continue
    const prev = states.get(productId)
    const dropped = prev && prev.currency === now.currency && now.min < prev.minPriceMinor && prev.minPriceMinor - now.min >= Math.max(1, Math.ceil(prev.minPriceMinor * 0.01)) && now.available > 0
    const restocked = prev && prev.available === 0 && now.available > 0
    await withTx(async (tx) => {
      if (dropped || restocked) {
        const holders = await tx.select({ userId: shopperWishlist.userId }).from(shopperWishlist).where(eq(shopperWishlist.productId, productId))
        const ws = await watchersOf(holders.map((h) => h.userId))
        const prefs = await getPreferencesMany([...ws.keys()])
        const ix = indexed.get(productId)
        const meta = { productId, title: ix?.title ?? now.title, slug: ix?.slug ?? sampleProductDoc(productId)?.slug ?? null, brandName: ix?.brandName ?? null, image: ix?.image ?? null }
        for (const w of ws.values()) {
          const pr = prefs.get(w.userId)!
          if (dropped) await tell(w, "price_drop", { ...meta, price: money(now.min, now.currency), was: money(prev!.minPriceMinor, prev!.currency) }, `${productId}:${now.min}`, pr.inApp[inAppPref("wishlist.price_drop")!])
          else await tell(w, "back_in_stock", meta, `${productId}:${new Date().toISOString().slice(0, 10)}`, pr.inApp[inAppPref("wishlist.back_in_stock")!])
        }
        if (dropped) priceDrops++
        else restocks++
      }
      await tx
        .insert(productWatchState)
        .values({ productId, currency: now.currency, minPriceMinor: now.min, available: now.available, checkedAt: new Date() })
        .onConflictDoUpdate({ target: productWatchState.productId, set: { currency: now.currency, minPriceMinor: now.min, available: now.available, checkedAt: new Date() } })
    })
  }

  // Variant-level requests.
  const ready = pendingBis.filter((r) => (byVariant.get(r.variantId)?.available ?? 0) > 0)
  if (ready.length) {
    const ws = await watchersOf([...new Set(ready.map((r) => r.userId))])
    const prefs = await getPreferencesMany([...ws.keys()])
    const ix = new Map((await indexedProducts([...new Set(ready.map((r) => r.productId))])).map((r) => [r.productId, r]))
    for (const r of ready) {
      const w = ws.get(r.userId)
      const v = byVariant.get(r.variantId)!
      await withTx(async (tx) => {
        const [claimed] = await tx
          .update(backInStockRequests)
          .set({ notifiedAt: new Date() })
          .where(and(eq(backInStockRequests.id, r.id), isNull(backInStockRequests.notifiedAt)))
          .returning({ id: backInStockRequests.id })
        if (!claimed || !w) return
        const row = ix.get(r.productId)
        await tell(w, "back_in_stock", { productId: r.productId, title: row?.title ?? v.title, slug: row?.slug ?? sampleProductDoc(r.productId)?.slug ?? null, brandName: row?.brandName ?? null, variant: v.variantLabel, image: row?.image ?? v.imagePath ?? null }, `variant:${r.id}`, prefs.get(w.userId)!.inApp.back_in_stock)
        variantRestocks++
      })
    }
  }
  return { priceDrops, restocks, variantRestocks }
}

export const jobs = {
  /** Hourly. */
  watchPrices,
}

/** AUTH erasure hook: back-in-stock watches go (AUTH itself deletes shopper_follows / shopper_wishlist / reminders). */
export async function eraseCustomerData(tx: Executor, userId: string): Promise<{ erased: number }> {
  const rows = await tx.delete(backInStockRequests).where(eq(backInStockRequests.userId, userId)).returning({ id: backInStockRequests.id })
  await tx.delete(shopperFollows).where(eq(shopperFollows.userId, userId))
  await tx.delete(shopperWishlist).where(eq(shopperWishlist.userId, userId))
  return { erased: rows.length }
}
