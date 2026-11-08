import "server-only"
import { and, asc, count, desc, eq, gt, gte, inArray, sql, type SQL } from "drizzle-orm"
import { currencies, type CurrencyCode } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { categoryBySlug } from "@/lib/data/catalog"
import { products as sampleProducts } from "@/lib/data/products"
import { convert } from "@/lib/money"
import { db } from "../db"
import { brands } from "../db/schema"
import { searchBrands, searchProducts } from "../db/schema/engagement"
import { log } from "../log"
import { productDoc, type SearchProductDoc } from "./catalog-port"

/**
 * Search (ENGAGEMENT v3): Postgres full-text search ('simple' config, prefix matching, weighted
 * title/brand > category/tags > description) over products and brands, with facets for category,
 * brand and price in the shopper's currency (static rates from src/config/markets via lib/money).
 *
 * The index is written only here. CATALOG calls reindexProduct(productId) after every product
 * change (create, edit, publish, unpublish, stock, moderation hide); a daily job re-indexes all.
 */
export const IMPL: string = "ENGAGEMENT-v3-2026-11-08"
export type { SearchProductDoc } from "./catalog-port"

const isCurrency = (c: string): c is CurrencyCode => c in currencies

/** USD minor units for sorting and filtering across currencies (0 for an unknown currency). */
function usdMinor(amount: number, currency: string) {
  return isCurrency(currency) ? convert(amount, currency, "USD") : 0
}

/**
 * Contract: re-indexes one product. With no `doc`, the product is read from CATALOG's optional
 * getProductForSearch (or the sample catalogue). A product no source knows is removed from the
 * index; a hidden one stays but never matches. Joins the caller's transaction; never throws for a
 * missing product.
 */
export async function reindexProduct(productId: string, doc?: SearchProductDoc | null): Promise<void> {
  const d = await db()
  const src = doc === undefined ? await productDoc(productId) : doc
  if (src === undefined) {
    await d.delete(searchProducts).where(eq(searchProducts.productId, productId))
    return
  }
  if (src === null) {
    await d.update(searchProducts).set({ visible: false, indexedAt: new Date() }).where(eq(searchProducts.productId, productId))
    return
  }
  const [brand] = await d.select({ id: brands.id, name: brands.name, reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, src.brandId)).limit(1)
  if (!brand) {
    log.once(`search:no-brand:${src.brandId}`, "warn", `[yard] reindexProduct: brand ${src.brandId} isn't in the brands table; product ${productId} not indexed`)
    return
  }
  const tags = (src.tags ?? []).map((t) => t.slice(0, 40)).slice(0, 30)
  const values = {
    brandId: src.brandId,
    brandName: brand.name,
    slug: src.slug ?? null,
    title: src.title.slice(0, 200),
    description: (src.description ?? "").slice(0, 4000),
    category: src.category ?? null,
    subcategory: src.subcategory ?? null,
    tagsText: tags.join(" "),
    tags,
    priceMinor: Math.max(0, Math.round(src.priceMinor)),
    compareAtMinor: src.compareAtMinor ?? null,
    currency: src.currency,
    priceUsdMinor: usdMinor(src.priceMinor, src.currency),
    available: Math.max(0, Math.round(src.available)),
    variantIds: src.variantIds.slice(0, 500),
    image: src.image ?? null,
    visible: src.visible && brand.reviewStatus !== "suspended",
    publishedAt: src.publishedAt ? new Date(src.publishedAt) : null,
    indexedAt: new Date(),
  }
  await d
    .insert(searchProducts)
    .values({ productId, ...values })
    .onConflictDoUpdate({ target: searchProducts.productId, set: values })
}

/** Re-indexes one brand from the brands table (plus the sample brand's tagline). */
export async function reindexBrand(brandId: string): Promise<void> {
  const d = await db()
  const [b] = await d.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!b) {
    await d.delete(searchBrands).where(eq(searchBrands.brandId, brandId))
    return
  }
  const sample = brandById.get(b.id)
  const values = {
    handle: b.handle,
    name: b.name,
    city: b.city,
    country: b.country,
    categoriesText: b.categories.map((c) => categoryBySlug.get(c as never)?.name ?? c).join(" "),
    tagline: sample?.tagline ?? "",
    visible: b.reviewStatus !== "suspended",
    indexedAt: new Date(),
  }
  await d
    .insert(searchBrands)
    .values({ brandId: b.id, ...values })
    .onConflictDoUpdate({ target: searchBrands.brandId, set: values })
  // A brand's suspension hides its products too.
  await d
    .update(searchProducts)
    .set({ brandName: b.name, visible: sql`${searchProducts.visible} and ${b.reviewStatus !== "suspended"}` })
    .where(eq(searchProducts.brandId, b.id))
}

/** Rebuilds the whole index: every brand, every product already indexed, and the sample catalogue. */
export async function reindexAll(): Promise<{ brands: number; products: number }> {
  const d = await db()
  const brandRows = await d.select({ id: brands.id }).from(brands)
  for (const b of brandRows) await reindexBrand(b.id)
  const known = await d.select({ id: searchProducts.productId }).from(searchProducts)
  const ids = new Set([...known.map((r) => r.id), ...sampleProducts.map((p) => p.id)])
  for (const id of ids) await reindexProduct(id)
  return { brands: brandRows.length, products: ids.size }
}

/* ---------- Queries ---------- */

/** Letters and digits only, as prefix terms joined with AND: safe to hand to to_tsquery. */
export function toTsQuery(q: string | undefined | null): string | null {
  const tokens = (q ?? "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const uniq = [...new Set(tokens.filter((t) => t.length <= 40))].slice(0, 8)
  return uniq.length ? uniq.map((t) => `${t}:*`).join(" & ") : null
}

export type SearchParams = {
  q?: string
  category?: string
  brandIds?: string[]
  /** Price bounds in the shopper's currency, minor units. */
  minPrice?: number
  maxPrice?: number
  currency: CurrencyCode
  inStock?: boolean
  sort?: "relevance" | "price_asc" | "price_desc" | "newest"
  limit?: number
  offset?: number
}

/** USD bucket edges (minor units) shown in the shopper's currency. */
const PRICE_EDGES_USD = [0, 2500, 5000, 10000, 25000, 50000]

export async function searchCatalog(p: SearchParams) {
  const d = await db()
  const tsq = toTsQuery(p.q)
  const query = tsq ? sql`to_tsquery('simple', ${tsq})` : null
  const limit = Math.min(Math.max(p.limit ?? 24, 1), 48)
  const offset = Math.min(Math.max(p.offset ?? 0, 0), 2000)

  const base: SQL[] = [eq(searchProducts.visible, true)]
  if (query) base.push(sql`${searchProducts.tsv} @@ ${query}`)
  if (p.inStock) base.push(gt(searchProducts.available, 0))
  const byCategory = p.category ? eq(searchProducts.category, p.category) : undefined
  const byBrand = p.brandIds?.length ? inArray(searchProducts.brandId, p.brandIds.slice(0, 20)) : undefined
  const priceConds: SQL[] = []
  if (p.minPrice != null) priceConds.push(gte(searchProducts.priceUsdMinor, convert(p.minPrice, p.currency, "USD")))
  if (p.maxPrice != null) priceConds.push(sql`${searchProducts.priceUsdMinor} <= ${convert(p.maxPrice, p.currency, "USD")}`)
  const byPrice = priceConds.length ? and(...priceConds) : undefined

  const where = and(...base, byCategory, byBrand, byPrice)
  const rank = query ? sql<number>`ts_rank(${searchProducts.tsv}, ${query})` : sql<number>`0`
  const order =
    p.sort === "price_asc"
      ? [asc(searchProducts.priceUsdMinor), asc(searchProducts.productId)]
      : p.sort === "price_desc"
        ? [desc(searchProducts.priceUsdMinor), asc(searchProducts.productId)]
        : p.sort === "newest" || !query
          ? [sql`${searchProducts.publishedAt} desc nulls last`, asc(searchProducts.productId)]
          : [desc(rank), desc(searchProducts.available), asc(searchProducts.productId)]

  const [rows, [{ total }], categoryFacet, brandFacet, priceFacet] = await Promise.all([
    d
      .select({
        productId: searchProducts.productId,
        brandId: searchProducts.brandId,
        brandName: searchProducts.brandName,
        slug: searchProducts.slug,
        title: searchProducts.title,
        category: searchProducts.category,
        subcategory: searchProducts.subcategory,
        priceMinor: searchProducts.priceMinor,
        compareAtMinor: searchProducts.compareAtMinor,
        currency: searchProducts.currency,
        available: searchProducts.available,
        image: searchProducts.image,
        rank,
      })
      .from(searchProducts)
      .where(where)
      .orderBy(...order)
      .limit(limit)
      .offset(offset),
    d.select({ total: count() }).from(searchProducts).where(where),
    d
      .select({ value: searchProducts.category, count: count() })
      .from(searchProducts)
      .where(and(...base, byBrand, byPrice))
      .groupBy(searchProducts.category)
      .orderBy(desc(count())),
    d
      .select({ value: searchProducts.brandId, label: searchProducts.brandName, count: count() })
      .from(searchProducts)
      .where(and(...base, byCategory, byPrice))
      .groupBy(searchProducts.brandId, searchProducts.brandName)
      .orderBy(desc(count()))
      .limit(30),
    d
      .select({
        bucket: sql<number>`width_bucket(${searchProducts.priceUsdMinor}, array[${sql.raw(PRICE_EDGES_USD.slice(1).join(","))}]::int[])`,
        count: count(),
      })
      .from(searchProducts)
      .where(and(...base, byCategory, byBrand))
      .groupBy(sql`1`),
  ])

  const counts = new Map(priceFacet.map((r) => [Number(r.bucket), r.count]))
  const price = PRICE_EDGES_USD.map((edge, i) => ({
    minMinor: convert(edge, "USD", p.currency),
    maxMinor: i + 1 < PRICE_EDGES_USD.length ? convert(PRICE_EDGES_USD[i + 1], "USD", p.currency) : null,
    count: counts.get(i) ?? 0,
  }))

  const items = rows.map((r) => ({
    productId: r.productId,
    brandId: r.brandId,
    brandName: r.brandName,
    slug: r.slug,
    title: r.title,
    category: r.category,
    subcategory: r.subcategory,
    image: r.image,
    available: r.available,
    price: { amount: r.priceMinor, currency: r.currency },
    compareAt: r.compareAtMinor != null ? { amount: r.compareAtMinor, currency: r.currency } : null,
    /** The price in the shopper's currency at Yard's reference rates (display only; checkout charges the brand's price). */
    display: { amount: isCurrency(r.currency) ? convert(r.priceMinor, r.currency, p.currency) : r.priceMinor, currency: isCurrency(r.currency) ? p.currency : r.currency },
  }))

  const brandHits = query && offset === 0 ? await searchBrandsQuery(p.q ?? "", 6) : []
  const next = offset + items.length < total ? String(offset + items.length) : null

  return {
    items,
    total,
    nextCursor: next,
    brands: brandHits,
    facets: {
      categories: categoryFacet.filter((c) => c.value).map((c) => ({ value: c.value!, label: categoryBySlug.get(c.value as never)?.name ?? c.value!, count: c.count })),
      brands: brandFacet.map((b) => ({ value: b.value, label: b.label, count: b.count })),
      price: { currency: p.currency, buckets: price },
    },
  }
}

export async function searchBrandsQuery(q: string, limit = 10) {
  const tsq = toTsQuery(q)
  if (!tsq) return []
  const d = await db()
  const query = sql`to_tsquery('simple', ${tsq})`
  const rows = await d
    .select({ brandId: searchBrands.brandId, handle: searchBrands.handle, name: searchBrands.name, city: searchBrands.city, country: searchBrands.country, rank: sql<number>`ts_rank(${searchBrands.tsv}, ${query})` })
    .from(searchBrands)
    .where(and(eq(searchBrands.visible, true), sql`${searchBrands.tsv} @@ ${query}`))
    .orderBy(desc(sql`ts_rank(${searchBrands.tsv}, ${query})`), asc(searchBrands.name))
    .limit(Math.min(limit, 20))
  return rows.map(({ rank: _rank, ...r }) => r)
}

/** Type-ahead: a few product titles and brands for a prefix. */
export async function suggest(q: string) {
  const tsq = toTsQuery(q)
  if (!tsq) return { products: [], brands: [] }
  const d = await db()
  const query = sql`to_tsquery('simple', ${tsq})`
  const [productsHit, brandsHit] = await Promise.all([
    d
      .select({ productId: searchProducts.productId, title: searchProducts.title, brandName: searchProducts.brandName, slug: searchProducts.slug, image: searchProducts.image })
      .from(searchProducts)
      .where(and(eq(searchProducts.visible, true), sql`${searchProducts.tsv} @@ ${query}`))
      .orderBy(desc(sql`ts_rank(${searchProducts.tsv}, ${query})`), asc(searchProducts.productId))
      .limit(6),
    searchBrandsQuery(q, 4),
  ])
  return { products: productsHit, brands: brandsHit }
}

/** Index rows for products (used by follows/drops to learn a product's brand and variants without CATALOG's tables). */
export async function indexedProducts(productIds: string[]) {
  if (!productIds.length) return []
  const d = await db()
  return d
    .select({ productId: searchProducts.productId, brandId: searchProducts.brandId, brandName: searchProducts.brandName, title: searchProducts.title, slug: searchProducts.slug, variantIds: searchProducts.variantIds, visible: searchProducts.visible, priceMinor: searchProducts.priceMinor, currency: searchProducts.currency, available: searchProducts.available, image: searchProducts.image })
    .from(searchProducts)
    .where(inArray(searchProducts.productId, productIds))
}

/** True when the index is empty (first boot): the daily job then builds it. */
async function indexEmpty() {
  const d = await db()
  const [row] = await d.select({ n: count() }).from(searchProducts)
  return (row?.n ?? 0) === 0
}

export const jobs = {
  /** Daily (and at first boot when the index is empty). */
  reindex: async () => reindexAll(),
  /** Every few minutes: builds the index if it is empty. */
  ensureIndex: async () => ((await indexEmpty()) ? reindexAll() : null),
}
