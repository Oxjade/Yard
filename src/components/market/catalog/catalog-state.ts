import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { convert, toMinor } from "@/lib/money"
import { brandByHandle, brandById, categoryBySlug, type ProductSort } from "@/lib/data"
import type { Brand, CategorySlug, Product } from "@/lib/data/types"

/**
 * Catalogue state lives in the URL so a filtered listing can be shared. This module is
 * pure (no React), so the same functions run on the server render and on the client.
 */

export const PAGE_SIZE = 24
/**
 * The deepest page a listing loads (a shared ?page= link included); past it the shopper is asked
 * to narrow the search. 50 × 24 = 1200 pieces, inside the search API's offset ceiling.
 */
export const MAX_CATALOG_PAGES = 50

export type CatalogState = {
  q: string
  category?: CategorySlug
  sub?: string
  brands: string[]
  /** USD major units */
  min?: number
  max?: number
  sizes: string[]
  inStock: boolean
  country?: CountryCode
  sort: ProductSort
  page: number
}

/** A listing is either the whole shop or one category (fixed by the route). */
export type CatalogScope = { category?: CategorySlug }

export const sortOptions: { value: ProductSort; label: string }[] = [
  { value: "trending", label: "Trending" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price low–high" },
  { value: "price-desc", label: "Price high–low" },
]

/** USD bands. The labels are converted to the shopper's currency where they are shown. */
export const priceBands: { min?: number; max?: number }[] = [
  { max: 50 },
  { min: 50, max: 100 },
  { min: 100, max: 200 },
  { min: 200, max: 300 },
  { min: 300 },
]

export const sizeGroups = [
  { id: "clothing", label: "Clothing", values: ["XS", "S", "M", "L", "XL"], chip: (v: string) => `Size ${v}` },
  { id: "shoes", label: "Shoes, EU", values: ["39", "40", "41", "42", "43", "44", "45"], chip: (v: string) => `EU ${v}` },
  { id: "rings", label: "Rings, US", values: ["6", "7", "8", "9", "10"], chip: (v: string) => `Ring size ${v}` },
] as const

const knownSizes = new Set<string>(sizeGroups.flatMap((g) => g.values))

export function sizeChipLabel(size: string) {
  const group = sizeGroups.find((g) => (g.values as readonly string[]).includes(size))
  return group ? group.chip(size) : size
}

export type SearchFacetPayload = {
  categories: { value: string; label: string; count: number }[]
  brands: { value: string; handle: string; label: string; count: number }[]
  /** The next page of `brands` (/api/search?brandCursor=), or null when that was all of them. */
  brandsNextCursor?: string | null
  /** Names of the brands filtered on (they may have no matches, or be on a later facet page). */
  selectedBrands?: { value: string; handle: string; label: string }[]
  price: { currency: string; buckets: { minMinor: number; maxMinor: number | null; count: number }[] }
  sizes: { value: string; count: number }[]
  countries: { value: string; count: number }[]
  inStockCount: number
}

export type CatalogSearchResponse = {
  items: { productId: string }[]
  total: number
  brandCount: number
  nextCursor: string | null
  facets: SearchFacetPayload
}

/** The listing's server first page: its products and the search response they came from. */
export type CatalogInitialPage = { key: string; products: Product[]; response: CatalogSearchResponse }

export type CatalogBrandFacet = { brand: Pick<Brand, "id" | "handle" | "name" | "mark">; count: number }

export type CatalogFacets = {
  brandFacet: CatalogBrandFacet[]
  /** More brands match than brandFacet holds: load them with /api/search?brandCursor=. */
  brandsNextCursor: string | null
  priceFacet: { min?: number; max?: number; count: number }[]
  sizeFacet: { id: string; label: string; values: { value: string; count: number }[] }[]
  countryFacet: { code: CountryCode; name: string; count: number }[]
  inStockCount: number
}

export const EMPTY_CATALOG_FACETS: CatalogFacets = {
  brandFacet: [],
  brandsNextCursor: null,
  priceFacet: [],
  sizeFacet: [],
  countryFacet: [],
  inStockCount: 0,
}

/** Build the server query from URL state; price bounds stay USD-major in the URL. */
/**
 * The currency the server renders the first page in, and the browser uses before hydrating: the
 * default shopper currency (session.ts defaults to NGN), so for most visitors the hydrated search
 * key matches the server's and the server-rendered grid stays.
 */
export const CATALOG_SSR_CURRENCY = "NGN" satisfies CurrencyCode

export function catalogSearchQuery(state: CatalogState, currency: CurrencyCode, cursor?: string, limit = PAGE_SIZE) {
  return {
    q: state.q || undefined,
    category: state.category,
    subcategory: state.sub,
    brandHandles: state.brands.length ? state.brands.join(",") : undefined,
    min: state.min === undefined ? undefined : convert(toMinor(state.min, "USD"), "USD", currency),
    max: state.max === undefined ? undefined : convert(toMinor(state.max, "USD"), "USD", currency),
    currency,
    inStock: state.inStock ? "1" : undefined,
    sizes: state.sizes.length ? state.sizes.join(",") : undefined,
    country: state.country,
    sort: state.sort === "price-asc" ? "price_asc" : state.sort === "price-desc" ? "price_desc" : state.sort === "newest" ? "newest" : "trending",
    limit,
    cursor,
  }
}

/** A stable key for one search request (its defined fields, in order): the server and the browser build the same one. */
export function catalogSearchKey(query: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
  return params.toString()
}

/** The facet's brands as the panel lists them. The mark is the sample brand's where there is one; the name is always the server's. */
export function brandFacetEntries(brands: SearchFacetPayload["brands"]): CatalogBrandFacet[] {
  return brands.map(({ value, handle, label, count }) => {
    const known = brandById.get(value) ?? brandByHandle.get(handle)
    return {
      brand: {
        id: value,
        handle,
        name: label,
        mark: known?.mark ?? { text: label.slice(0, 2).toUpperCase(), style: "condensed" as const },
      },
      count,
    }
  })
}

export function catalogFacetsFromSearch(payload: SearchFacetPayload, state: CatalogState): CatalogFacets {
  const brandFacet = brandFacetEntries(payload.brands)
  // A brand filtered on stays in the list (with 0) even when nothing here matches it; its name is the server's.
  for (const handle of state.brands) {
    if (brandFacet.some(({ brand }) => brand.handle === handle)) continue
    const selected = payload.selectedBrands?.find((b) => b.handle === handle)
    const [entry] = brandFacetEntries([{ value: selected?.value ?? handle, handle, label: selected?.label ?? handle, count: 0 }])
    brandFacet.push(entry)
  }

  const sizeCounts = new Map(payload.sizes.map(({ value, count }) => [value, count]))
  const sizeFacet = sizeGroups
    .map((group) => ({
      id: group.id,
      label: group.label,
      values: group.values
        .filter((value) => sizeCounts.has(value) || state.sizes.includes(value))
        .map((value) => ({ value, count: sizeCounts.get(value) ?? 0 })),
    }))
    .filter((group) => group.values.length > 0)

  const countryCounts = new Map(payload.countries.map(({ value, count }) => [value, count]))
  if (state.country && !countryCounts.has(state.country)) countryCounts.set(state.country, 0)
  const countryFacet = [...countryCounts.entries()]
    .filter(([code]) => code in countries)
    .map(([code, count]) => ({ code: code as CountryCode, name: countries[code as CountryCode].name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    brandFacet,
    brandsNextCursor: payload.brandsNextCursor ?? null,
    priceFacet: priceBands.map((band, index) => ({ ...band, count: payload.price.buckets[index]?.count ?? 0 })),
    sizeFacet,
    countryFacet,
    inStockCount: payload.inStockCount,
  }
}

export const emptyState = (scope: CatalogScope): CatalogState => ({
  q: "",
  category: scope.category,
  brands: [],
  sizes: [],
  inStock: false,
  sort: "trending",
  page: 1,
})

type ParamsLike = { get(name: string): string | null }

function list(value: string | null) {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : []
}

function amount(value: string | null) {
  if (value === null || value.trim() === "") return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Reads the URL. Anything unknown or malformed is ignored rather than breaking the page. */
export function parseCatalogParams(params: ParamsLike, scope: CatalogScope, knownBrandHandles: string[] = []): CatalogState {
  const rawCategory = params.get("category") as CategorySlug | null
  const category = scope.category ?? (rawCategory && categoryBySlug.has(rawCategory) ? rawCategory : undefined)
  const rawSub = params.get("sub")
  const sub = category && rawSub && categoryBySlug.get(category)!.subcategories.includes(rawSub) ? rawSub : undefined
  let min = amount(params.get("min"))
  let max = amount(params.get("max"))
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min]
  const rawCountry = params.get("country") as CountryCode | null
  const rawSort = params.get("sort") as ProductSort | null
  const page = Math.floor(Number(params.get("page") ?? 1))
  return {
    q: (params.get("q") ?? "").trim().slice(0, 80),
    category,
    sub,
    brands: [...new Set(list(params.get("brands")).filter((h) => brandByHandle.has(h) || knownBrandHandles.includes(h) || /^[a-z0-9][a-z0-9-]{0,62}$/.test(h)))],
    min,
    max,
    sizes: [...new Set(list(params.get("size")).filter((s) => knownSizes.has(s)))],
    inStock: params.get("stock") === "1",
    country: rawCountry && rawCountry in countries ? rawCountry : undefined,
    sort: rawSort && sortOptions.some((o) => o.value === rawSort) ? rawSort : "trending",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_CATALOG_PAGES) : 1,
  }
}

export function serializeCatalogParams(state: CatalogState, scope: CatalogScope) {
  const p = new URLSearchParams()
  if (state.q) p.set("q", state.q)
  if (state.category && !scope.category) p.set("category", state.category)
  if (state.sub) p.set("sub", state.sub)
  if (state.brands.length) p.set("brands", state.brands.join(","))
  if (state.min !== undefined) p.set("min", String(state.min))
  if (state.max !== undefined) p.set("max", String(state.max))
  if (state.sizes.length) p.set("size", state.sizes.join(","))
  if (state.inStock) p.set("stock", "1")
  if (state.country) p.set("country", state.country)
  if (state.sort !== "trending") p.set("sort", state.sort)
  if (state.page > 1) p.set("page", String(state.page))
  // Keep commas readable in shared links.
  return p.toString().replace(/%2C/g, ",")
}

/** Filters that narrow the result set (sort and page excluded; the route's own category excluded). */
export function activeFilterCount(state: CatalogState, scope: CatalogScope) {
  return (
    (state.q ? 1 : 0) +
    (state.category && !scope.category ? 1 : 0) +
    (state.sub ? 1 : 0) +
    state.brands.length +
    (state.min !== undefined || state.max !== undefined ? 1 : 0) +
    state.sizes.length +
    (state.inStock ? 1 : 0) +
    (state.country ? 1 : 0)
  )
}

/** Panel-only filters: what the filter sheet changes (search and chips sit on the page). */
export function panelFilterCount(state: CatalogState) {
  return state.brands.length + (state.min !== undefined || state.max !== undefined ? 1 : 0) + state.sizes.length + (state.inStock ? 1 : 0) + (state.country ? 1 : 0)
}

export type ListingEntry = { item: Product; sponsored: boolean }

/**
 * One page of the listing is one 24-card cycle of the grid rhythm: six standard cards, a
 * feature band (one large card beside two), six more, an editorial brand spotlight, a row of
 * tall cards and six more standard cards. The grid lays cycles out with this pattern.
 */
export const cyclePattern = [
  { kind: "grid", n: 6 },
  { kind: "feature", n: 3 },
  { kind: "grid", n: 6 },
  { kind: "spotlight", n: 0 },
  { kind: "tall", n: 3 },
  { kind: "grid", n: 6 },
] as const

export type ListingCycle = {
  /** Index of this cycle's first card in the whole listing. */
  start: number
  entries: ListingEntry[]
  /** Browse only: one brand from this cycle and up to two of its pieces from further down. */
  spotlight?: { brand: Brand; products: Product[] }
}

export function buildListingFromResults(results: Product[], total: number, brandCount: number, hasMore: boolean) {
  const cycles: ListingCycle[] = []
  for (let start = 0; start < results.length; start += PAGE_SIZE) {
    cycles.push({ start, entries: results.slice(start, start + PAGE_SIZE).map((item) => ({ item, sponsored: false })) })
  }
  return {
    total,
    cycles,
    cardCount: results.length,
    shown: results.length,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    hasMore,
    nextCount: Math.min(PAGE_SIZE, Math.max(0, total - results.length)),
    brandCount,
  }
}

export type Listing = ReturnType<typeof buildListingFromResults>
