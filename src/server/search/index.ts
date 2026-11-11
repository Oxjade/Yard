import "server-only"
import { and, asc, count, desc, eq, gt, gte, inArray, lt, lte, sql, type SQL } from "drizzle-orm"
import { currencies, type CurrencyCode } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { categoryBySlug } from "@/lib/data/catalog"
import { products as sampleProducts } from "@/lib/data/products"
import { convert } from "@/lib/money"
import { db } from "../db"
import { brands } from "../db/schema"
import { shopperWishlist } from "../db/schema/charts"
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
  const [brand] = await d.select({ id: brands.id, handle: brands.handle, name: brands.name, country: brands.country, reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, src.brandId)).limit(1)
  if (!brand) {
    log.once(`search:no-brand:${src.brandId}`, "warn", `[yard] reindexProduct: brand ${src.brandId} isn't in the brands table; product ${productId} not indexed`)
    return
  }
  const tags = (src.tags ?? []).map((t) => t.slice(0, 40)).slice(0, 30)
  const values = {
    brandId: src.brandId,
    brandHandle: brand.handle,
    brandName: brand.name,
    country: brand.country,
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
    sizes: [...new Set((src.sizes ?? []).filter((size) => size && size !== "One size"))],
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
    .set({ brandHandle: b.handle, brandName: b.name, country: b.country, visible: sql`${searchProducts.visible} and ${b.reviewStatus !== "suspended"}` })
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
  subcategory?: string
  brandIds?: string[]
  brandHandles?: string[]
  sizes?: string[]
  country?: string
  /** Price bounds in the shopper's currency, minor units. */
  minPrice?: number
  maxPrice?: number
  currency: CurrencyCode
  inStock?: boolean
  sort?: "relevance" | "price_asc" | "price_desc" | "newest" | "trending"
  limit?: number
  offset?: number
  /** Offset into the brand facet (it is paged, BRAND_FACET_PAGE brands at a time). */
  brandOffset?: number
}

/** The scope a search runs in, without the words: what the listing's filters narrow to. */
export type SearchScope = Omit<SearchParams, "q" | "sort" | "limit" | "offset" | "brandOffset">

/** The deepest a listing pages (offset); past it a shopper is asked to narrow the search. */
export const MAX_SEARCH_OFFSET = 2000
/** Brands per page of the brand facet. */
export const BRAND_FACET_PAGE = 100
/** How far back saves count towards "trending". */
const TRENDING_DAYS = 30

/** Price filter bands in USD minor units, matching the catalog's visible controls. */
const PRICE_BANDS_USD = [
  { min: 0, max: 5000 },
  { min: 5000, max: 10000 },
  { min: 10000, max: 20000 },
  { min: 20000, max: 30000 },
  { min: 30000, max: null },
]

/** The filter conditions of a scope, one per facet so each facet can leave its own out. */
function scopeConditions(p: SearchScope) {
  const byStock = p.inStock ? gt(searchProducts.available, 0) : undefined
  const byCategory = p.category ? eq(searchProducts.category, p.category) : undefined
  const bySubcategory = p.subcategory ? eq(searchProducts.subcategory, p.subcategory) : undefined
  const byBrand = p.brandIds?.length ? inArray(searchProducts.brandId, p.brandIds.slice(0, 20)) : undefined
  const byBrandHandle = p.brandHandles?.length ? inArray(searchProducts.brandHandle, p.brandHandles.slice(0, 20)) : undefined
  // Array overlap (&&) so the GIN index on sizes can serve it.
  const sizes = p.sizes?.slice(0, 12) ?? []
  const bySize = sizes.length ? sql`${searchProducts.sizes} && ${sql`array[${sql.join(sizes.map((size) => sql`${size}`), sql`, `)}]::text[]`}` : undefined
  const byCountry = p.country ? eq(searchProducts.country, p.country) : undefined
  const priceConds: SQL[] = []
  if (p.minPrice != null) priceConds.push(gte(searchProducts.priceUsdMinor, convert(p.minPrice, p.currency, "USD")))
  // Half-open, like the bands: a max that is a band edge belongs to the band above it, so a $50.00
  // piece is in "$50–$100" only. A custom max typed off a band edge stays inclusive.
  if (p.maxPrice != null) {
    const maxUsd = convert(p.maxPrice, p.currency, "USD")
    // Within a cent of an edge counts as the edge: the shopper's currency round trip can move it by one.
    const edge = PRICE_BANDS_USD.find((band) => band.max != null && Math.abs(band.max - maxUsd) <= 1)?.max
    priceConds.push(edge != null ? lt(searchProducts.priceUsdMinor, edge) : lte(searchProducts.priceUsdMinor, maxUsd))
  }
  const byPrice = priceConds.length ? and(...priceConds) : undefined
  return { byStock, byCategory, bySubcategory, byBrand, byBrandHandle, bySize, byCountry, byPrice }
}

export async function searchCatalog(p: SearchParams) {
  const d = await db()
  const tsq = toTsQuery(p.q)
  const query = tsq ? sql`to_tsquery('simple', ${tsq})` : null
  const limit = Math.min(Math.max(p.limit ?? 24, 1), 48)
  const offset = Math.min(Math.max(p.offset ?? 0, 0), MAX_SEARCH_OFFSET)
  const brandOffset = Math.max(p.brandOffset ?? 0, 0)

  const base: SQL[] = [eq(searchProducts.visible, true)]
  if (query) base.push(sql`${searchProducts.tsv} @@ ${query}`)
  const { byStock, byCategory, bySubcategory, byBrand, byBrandHandle, bySize, byCountry, byPrice } = scopeConditions(p)

  const where = and(...base, byStock, byCategory, bySubcategory, byBrand, byBrandHandle, byPrice, bySize, byCountry)
  const rank = query ? sql<number>`ts_rank(${searchProducts.tsv}, ${query})` : sql<number>`0`
  // Trending: saves in the last TRENDING_DAYS days (real shopper signals), then relevance, then newest.
  const recentSaves = d
    .select({ productId: shopperWishlist.productId, saves: sql<number>`count(*)`.as("saves") })
    .from(shopperWishlist)
    .where(sql`${shopperWishlist.createdAt} > now() - make_interval(days => ${TRENDING_DAYS})`)
    .groupBy(shopperWishlist.productId)
    .as("recent_saves")
  const order =
    p.sort === "trending"
      ? [sql`coalesce(${recentSaves.saves}, 0) desc`, ...(query ? [desc(rank)] : []), sql`${searchProducts.publishedAt} desc nulls last`, asc(searchProducts.productId)]
      : p.sort === "price_asc"
      ? [asc(searchProducts.priceUsdMinor), asc(searchProducts.productId)]
      : p.sort === "price_desc"
        ? [desc(searchProducts.priceUsdMinor), asc(searchProducts.productId)]
        : p.sort === "newest" || !query
          ? [sql`${searchProducts.publishedAt} desc nulls last`, asc(searchProducts.productId)]
          : [desc(rank), desc(searchProducts.available), asc(searchProducts.productId)]

  const rowFields = {
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
  }
  const rowsQuery =
    p.sort === "trending"
      ? d.select(rowFields).from(searchProducts).leftJoin(recentSaves, eq(recentSaves.productId, searchProducts.productId)).where(where).orderBy(...order).limit(limit).offset(offset)
      : d.select(rowFields).from(searchProducts).where(where).orderBy(...order).limit(limit).offset(offset)
  const selectedHandles = p.brandHandles?.slice(0, 20) ?? []

  const [rows, [{ total }], [{ brandCount }], categoryFacet, brandFacetPage, [priceCounts], sizeFacet, countryFacet, [{ inStockCount }], selectedBrands] = await Promise.all([
    rowsQuery,
    d.select({ total: count() }).from(searchProducts).where(where),
    d.select({ brandCount: sql<number>`count(distinct ${searchProducts.brandId})`.mapWith(Number) }).from(searchProducts).where(where),
    d
      .select({ value: searchProducts.category, count: count() })
      .from(searchProducts)
      .where(and(...base, byStock, byBrand, byBrandHandle, byPrice, bySize, byCountry))
      .groupBy(searchProducts.category)
      .orderBy(desc(count())),
    d
      .select({ value: searchProducts.brandId, handle: searchProducts.brandHandle, label: searchProducts.brandName, count: count() })
      .from(searchProducts)
      .where(and(...base, byStock, byCategory, bySubcategory, byPrice, bySize, byCountry))
      .groupBy(searchProducts.brandId, searchProducts.brandHandle, searchProducts.brandName)
      .orderBy(desc(count()), asc(searchProducts.brandName), asc(searchProducts.brandId))
      .limit(BRAND_FACET_PAGE + 1)
      .offset(brandOffset),
    d
      .select({
        // Half-open bands [min, max): every price is in exactly one band.
        under50: sql<number>`count(*) filter (where ${searchProducts.priceUsdMinor} < 5000)`.mapWith(Number),
        from50To100: sql<number>`count(*) filter (where ${searchProducts.priceUsdMinor} >= 5000 and ${searchProducts.priceUsdMinor} < 10000)`.mapWith(Number),
        from100To200: sql<number>`count(*) filter (where ${searchProducts.priceUsdMinor} >= 10000 and ${searchProducts.priceUsdMinor} < 20000)`.mapWith(Number),
        from200To300: sql<number>`count(*) filter (where ${searchProducts.priceUsdMinor} >= 20000 and ${searchProducts.priceUsdMinor} < 30000)`.mapWith(Number),
        over300: sql<number>`count(*) filter (where ${searchProducts.priceUsdMinor} >= 30000)`.mapWith(Number),
      })
      .from(searchProducts)
      .where(and(...base, byStock, byCategory, bySubcategory, byBrand, byBrandHandle, bySize, byCountry)),
    d
      .select({ value: sql<string>`unnest(${searchProducts.sizes})`, count: count() })
      .from(searchProducts)
      .where(and(...base, byStock, byCategory, bySubcategory, byBrand, byBrandHandle, byPrice, byCountry))
      .groupBy(sql`1`)
      .orderBy(desc(count())),
    d
      .select({ value: searchProducts.country, count: count() })
      .from(searchProducts)
      .where(and(...base, byStock, byCategory, bySubcategory, byBrand, byBrandHandle, byPrice, bySize))
      .groupBy(searchProducts.country)
      .orderBy(desc(count())),
    d.select({ inStockCount: count() }).from(searchProducts).where(and(...base, gt(searchProducts.available, 0), byCategory, bySubcategory, byBrand, byBrandHandle, byPrice, bySize, byCountry)),
    // Names of the brands the shopper filtered on, so their chips read right even with no matches here.
    selectedHandles.length
      ? d.select({ value: searchBrands.brandId, handle: searchBrands.handle, label: searchBrands.name }).from(searchBrands).where(inArray(searchBrands.handle, selectedHandles))
      : Promise.resolve([] as { value: string; handle: string; label: string }[]),
  ])
  const brandFacet = brandFacetPage.slice(0, BRAND_FACET_PAGE)
  const brandsNextCursor = brandFacetPage.length > BRAND_FACET_PAGE ? String(brandOffset + BRAND_FACET_PAGE) : null

  const priceFacet = PRICE_BANDS_USD.map((band, index) => ({
    minMinor: convert(band.min, "USD", p.currency),
    maxMinor: band.max == null ? null : convert(band.max, "USD", p.currency),
    count: [priceCounts.under50, priceCounts.from50To100, priceCounts.from100To200, priceCounts.from200To300, priceCounts.over300][index],
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
  // Paging stops at MAX_SEARCH_OFFSET; `capped` tells the listing to ask for a narrower search.
  const nextOffset = offset + items.length
  const next = nextOffset < total && nextOffset <= MAX_SEARCH_OFFSET ? String(nextOffset) : null
  const capped = nextOffset < total && next === null

  return {
    items,
    total,
    brandCount,
    nextCursor: next,
    capped,
    brands: brandHits,
    facets: {
      categories: categoryFacet.filter((c) => c.value).map((c) => ({ value: c.value!, label: categoryBySlug.get(c.value as never)?.name ?? c.value!, count: c.count })),
      brands: brandFacet.map((b) => ({ value: b.value, handle: b.handle, label: b.label, count: b.count })),
      brandsNextCursor,
      selectedBrands,
      price: { currency: p.currency, buckets: priceFacet },
      sizes: sizeFacet.filter((facet) => facet.count > 0),
      countries: countryFacet.filter((facet) => facet.value).map((facet) => ({ value: facet.value!, count: facet.count })),
      inStockCount,
    },
  }
}

export async function searchBrandsQuery(q: string, limit = 10) {
  const tsq = toTsQuery(q)
  if (!tsq) return []
  const d = await db()
  const query = sql`to_tsquery('simple', ${tsq})`
  const rows = await d
    .select({ brandId: searchBrands.brandId, handle: searchBrands.handle, name: searchBrands.name, city: searchBrands.city, country: searchBrands.country })
    .from(searchBrands)
    .where(and(eq(searchBrands.visible, true), sql`${searchBrands.tsv} @@ ${query}`))
    .orderBy(desc(sql`ts_rank(${searchBrands.tsv}, ${query})`), asc(searchBrands.name))
    .limit(Math.min(limit, 20))
  return rows
}

/**
 * Type-ahead: a few product titles and brands for a prefix. With a `scope` (a listing's category
 * and filters), `terms` also says how many pieces each completion would list there, so a listing
 * only offers completions that find something in it.
 */
export async function suggest(q: string, scope?: SearchScope) {
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
  if (!scope) return { products: productsHit, brands: brandsHit }

  const seen = new Set<string>()
  const candidates = [...productsHit.map((item) => item.title), ...brandsHit.map((brand) => brand.name)].flatMap((term) => {
    const key = term.trim().toLowerCase()
    const termQuery = toTsQuery(term)
    if (!key || !termQuery || seen.has(key)) return []
    seen.add(key)
    return [{ term, termQuery }]
  })
  if (!candidates.length) return { products: productsHit, brands: brandsHit, terms: [] }
  const { byStock, byCategory, bySubcategory, byBrand, byBrandHandle, bySize, byCountry, byPrice } = scopeConditions(scope)
  // One pass over the scope, one count per completion (the same match a search for it would make).
  const [counts] = await d
    .select(Object.fromEntries(candidates.map((c, i) => [`t${i}`, sql<number>`count(*) filter (where ${searchProducts.tsv} @@ to_tsquery('simple', ${c.termQuery}))`.mapWith(Number)])))
    .from(searchProducts)
    .where(and(eq(searchProducts.visible, true), byStock, byCategory, bySubcategory, byBrand, byBrandHandle, byPrice, bySize, byCountry))
  return { products: productsHit, brands: brandsHit, terms: candidates.map((c, i) => ({ term: c.term, count: Number(counts?.[`t${i}`] ?? 0) })) }
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
