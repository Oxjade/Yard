import { countries, type CountryCode } from "@/config/markets"
import { brandByHandle, brandById, brands, categoryBySlug, priceUsd, products, searchProducts, sponsoredProducts, type ProductSort } from "@/lib/data"
import { withSponsoredSlots } from "@/lib/data/ads"
import { availableStock, productStock } from "@/lib/data/products"
import type { Brand, CategorySlug, Product } from "@/lib/data/types"

/**
 * Catalogue state lives in the URL so a filtered listing can be shared. This module is
 * pure (no React), so the same functions run on the server render and on the client.
 */

export const PAGE_SIZE = 24
/** Sponsored slots are positions 5 and 14 of the listing (0-based 4 and 13), never 1–4. */
export const SPONSORED_SLOTS = [4, 13]

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
    brands: [...new Set(list(params.get("brands")).filter((h) => brandByHandle.has(h) || knownBrandHandles.includes(h)))],
    min,
    max,
    sizes: [...new Set(list(params.get("size")).filter((s) => knownSizes.has(s)))],
    inStock: params.get("stock") === "1",
    country: rawCountry && rawCountry in countries ? rawCountry : undefined,
    sort: rawSort && sortOptions.some((o) => o.value === rawSort) ? rawSort : "trending",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 50) : 1,
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

type Facet = "brands" | "price" | "sizes" | "country" | "stock"

/** Runs the catalogue query, optionally ignoring one facet so its own counts stay useful. */
export function filterProducts(state: CatalogState, omit?: Facet, source?: Product[]) {
  if (!source) {
    let results = searchProducts({
    q: state.q || undefined,
    category: state.category,
    subcategory: state.sub,
    brands: omit === "brands" ? undefined : state.brands,
    minPrice: omit === "price" ? undefined : state.min,
    maxPrice: omit === "price" ? undefined : state.max,
    inStock: omit === "stock" ? undefined : state.inStock,
    country: omit === "country" ? undefined : state.country,
      sort: state.sort,
    })
    if (state.sizes.length && omit !== "sizes") {
      results = results.filter((p) => p.variants.some((v) => state.sizes.includes(v.options.Size) && availableStock(v) > 0))
    }
    return results
  }

  const q = state.q.toLowerCase()
  let results = source.filter((p) => {
    const brand = p.brandSummary ?? brandById.get(p.brandId)
    if (q && ![p.name, p.description, p.subcategory, p.category, brand?.name, ...p.tags].join(" ").toLowerCase().includes(q)) return false
    if (state.category && p.category !== state.category) return false
    if (state.sub && p.subcategory !== state.sub) return false
    if (omit !== "brands" && state.brands.length && !state.brands.includes(brand?.handle ?? "")) return false
    const usd = priceUsd(p)
    if (omit !== "price" && state.min !== undefined && usd < state.min) return false
    if (omit !== "price" && state.max !== undefined && usd > state.max) return false
    if (omit !== "stock" && state.inStock && productStock(p) <= 0) return false
    if (omit !== "country" && state.country && brand?.country !== state.country) return false
    return true
  })
  results = [...results].sort((a, b) => {
    if (state.sort === "newest") return b.createdAt.localeCompare(a.createdAt)
    if (state.sort === "price-asc") return priceUsd(a) - priceUsd(b)
    if (state.sort === "price-desc") return priceUsd(b) - priceUsd(a)
    return b.stats.trend - a.stats.trend
  })
  // Size is filtered here until the data layer takes it: a size counts only while it is in stock.
  if (state.sizes.length && omit !== "sizes") {
    results = results.filter((p) => p.variants.some((v) => state.sizes.includes(v.options.Size) && availableStock(v) > 0))
  }
  return results
}

export function computeFacets(state: CatalogState, source?: Product[]) {
  const byBrand = new Map<string, number>()
  const facetBrands = new Map<string, Pick<Brand, "id" | "handle" | "name" | "mark">>()
  for (const p of filterProducts(state, "brands", source)) {
    const fullBrand = brandById.get(p.brandId)
    const details = p.brandSummary ?? fullBrand
    if (!details) continue
    const h = details.handle
    facetBrands.set(h, { ...details, mark: fullBrand?.mark ?? { text: details.name.slice(0, 2).toUpperCase(), style: "condensed" } })
    byBrand.set(h, (byBrand.get(h) ?? 0) + 1)
  }
  // Order brands by their size within the search/category scope, so ticking other filters
  // changes the counts but never reshuffles the list under the shopper's finger.
  const scopeSize = new Map<string, number>()
  for (const p of filterProducts({ ...state, brands: [], min: undefined, max: undefined, sizes: [], inStock: false, country: undefined }, undefined, source)) {
    scopeSize.set(p.brandId, (scopeSize.get(p.brandId) ?? 0) + 1)
  }
  const brandFacet = [...facetBrands.values()]
    .filter((b) => byBrand.has(b.handle) || state.brands.includes(b.handle))
    .map((b) => ({ brand: b, count: byBrand.get(b.handle) ?? 0 }))
    .sort((a, b) => (scopeSize.get(b.brand.id) ?? 0) - (scopeSize.get(a.brand.id) ?? 0) || a.brand.name.localeCompare(b.brand.name))

  const forPrice = filterProducts(state, "price", source)
  const priceFacet = priceBands.map((band) => ({
    ...band,
    count: forPrice.filter((p) => {
      const usd = priceUsd(p)
      return (band.min === undefined || usd >= band.min) && (band.max === undefined || usd <= band.max)
    }).length,
  }))

  const bySize = new Map<string, number>()
  for (const p of filterProducts(state, "sizes", source)) {
    const inStock = new Set(p.variants.filter((v) => v.options.Size && availableStock(v) > 0).map((v) => v.options.Size))
    for (const s of inStock) bySize.set(s, (bySize.get(s) ?? 0) + 1)
  }
  const sizeFacet = sizeGroups
    .map((g) => ({ ...g, values: g.values.filter((v) => bySize.has(v) || state.sizes.includes(v)).map((v) => ({ value: v, count: bySize.get(v) ?? 0 })) }))
    .filter((g) => g.values.length > 0)

  const byCountry = new Map<CountryCode, number>()
  for (const p of filterProducts(state, "country", source)) {
    const c = p.brandSummary?.country ?? brandById.get(p.brandId)?.country
    if (c) byCountry.set(c, (byCountry.get(c) ?? 0) + 1)
  }
  const countryFacet = [...byCountry.entries()]
    .concat(state.country && !byCountry.has(state.country) ? [[state.country, 0] as [CountryCode, number]] : [])
    .map(([code, count]) => ({ code, name: countries[code].name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const inStockCount = filterProducts({ ...state, inStock: true }, undefined, source).length

  return { brandFacet, priceFacet, sizeFacet, countryFacet, inStockCount }
}

export type Facets = ReturnType<typeof computeFacets>

/* ---------- search suggestions ---------- */

/**
 * Every term the catalogue can answer: piece names, brand names, subcategories and tags.
 * Tags are stored lowercase; they are shown with a capital first letter so the list reads in
 * one case beside names ("Leather" next to "MO-2 Leather"). Matching ignores case either way.
 */
const vocabulary: string[] = (() => {
  const seen = new Map<string, string>()
  // "Hoodies" and "hoodie" are one suggestion: the first spelling met wins.
  const add = (term: string) => {
    const t = term.trim()
    const key = t.toLowerCase().replace(/s$/, "")
    if (t.length > 1 && !seen.has(key)) seen.set(key, t)
  }
  const capitalise = (tag: string) => tag.trim().charAt(0).toUpperCase() + tag.trim().slice(1)
  for (const p of products) {
    if (p.status !== "published") continue
    add(p.name)
    add(p.subcategory)
    p.tags.forEach((tag) => add(capitalise(tag)))
  }
  brands.forEach((b) => add(b.name))
  return [...seen.values()]
})()

export type SearchSuggestion = { term: string; count: number }

/** Matches inside a word ("lea" in "Pleated") are offered only when nothing starts with the text. */
const MID_WORD_FALLBACK = 1

/**
 * Completions for what the shopper is typing, each with the number of pieces it would list
 * under the current filters (a suggestion that would list nothing is left out). Terms that
 * start with the text come first, then terms with a word that does. A match inside a word
 * ("neck" in "Turtleneck") is offered only when no term or word starts with the text, and only
 * from three letters.
 */
export function searchSuggestions(typed: string, state: CatalogState, limit = 6, source?: Product[]): SearchSuggestion[] {
  const t = typed.trim().toLowerCase()
  if (t.length < 2) return []
  const rank = (term: string) => {
    const lower = term.toLowerCase()
    if (lower.startsWith(t)) return 0
    if (lower.split(/[\s-]+/).some((w) => w.startsWith(t))) return 1
    return 2
  }
  const out: SearchSuggestion[] = []
  const terms = source
    ? [...new Set(source.flatMap((p) => [p.name, p.subcategory, ...p.tags, p.brandSummary?.name ?? ""]).filter((term) => term.trim().length > 1))]
    : vocabulary
  const candidates = terms
    .filter((term) => term.toLowerCase().includes(t) && term.toLowerCase() !== t)
    .sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b))
  let wordStart = 0
  for (const term of candidates) {
    const r = rank(term)
    if (r === 2 && (t.length < 3 || wordStart >= MID_WORD_FALLBACK)) break
    const count = filterProducts({ ...state, q: term }, undefined, source).length
    if (count > 0) {
      out.push({ term, count })
      if (r < 2) wordStart++
    }
    if (out.length >= limit) break
  }
  return out
}

/** A search for a brand's own name is navigational: it stays ad-free. */
export function isNavigationalSearch(q: string) {
  const term = q.trim().toLowerCase()
  if (term.length < 3) return false
  return brands.some((b) => b.name.toLowerCase().includes(term) || term.includes(b.name.toLowerCase()) || term.includes(b.handle))
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

/** How many cards of a cycle come before its spotlight. */
const SPOTLIGHT_AT = cyclePattern.slice(0, cyclePattern.findIndex((s) => s.kind === "spotlight")).reduce((n, s) => n + s.n, 0)

export type ListingCycle = {
  /** Index of this cycle's first card in the whole listing. */
  start: number
  entries: ListingEntry[]
  /** Browse only: one brand from this cycle and up to two of its pieces from further down. */
  spotlight?: { brand: Brand; products: Product[] }
}

/** The brands of one cycle with at least two organic pieces in it, most pieces first. */
function rankBrands(entries: ListingEntry[]) {
  const counts = new Map<string, number>()
  for (const e of entries) if (!e.sponsored) counts.set(e.item.brandId, (counts.get(e.item.brandId) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => brandById.get(id)!)
}

/**
 * Splits the whole listing into cycles, independent of the page being shown, so "Load more"
 * only ever appends: a page that is on screen never changes. Each cycle's spotlight brand is
 * ranked over that cycle alone (a brand is spotlighted once), and its pieces come from further
 * down the listing and leave their later spot, so no piece renders twice.
 */
function planCycles(merged: ListingEntry[], editorial: boolean): ListingCycle[] {
  const rest = [...merged]
  const cycles: ListingCycle[] = []
  const used = new Set<string>()
  for (let offset = 0; offset < rest.length; offset += PAGE_SIZE) {
    const entries = rest.slice(offset, offset + PAGE_SIZE)
    const cycle: ListingCycle = { start: offset, entries }
    // The spotlight needs cards on both sides of it, so a short last page goes without.
    if (editorial && entries.length > SPOTLIGHT_AT) {
      const brand = rankBrands(entries).find((b) => !used.has(b.id))
      if (brand) {
        used.add(brand.id)
        const products: Product[] = []
        for (let k = offset + PAGE_SIZE; k < rest.length && products.length < 2; ) {
          if (!rest[k].sponsored && rest[k].item.brandId === brand.id) products.push(rest.splice(k, 1)[0].item)
          else k++
        }
        cycle.spotlight = { brand, products }
      }
    }
    cycles.push(cycle)
  }
  return cycles
}

/**
 * The visible listing: results in pages of PAGE_SIZE cards, with sponsored products in their
 * designated slots. A sponsored product must match the active filters and be in stock, at most
 * one per brand. It is never shown twice: if it already ranks at or above its slot organically
 * the slot stays organic; otherwise it moves into the labelled slot and leaves its organic spot.
 *
 * Sponsored slots exist only in the default Trending ranking. A sort the shopper chose (price,
 * newest) is a promise about order, so those listings carry no paid placements at all; neither
 * does a search for a brand's own name. Editorial spotlights are for browsing; a search stays a
 * clean grid.
 */
export function buildListing(state: CatalogState, source?: Product[]) {
  const results = filterProducts(state, undefined, source)
  const paidAllowed = !source && state.sort === "trending" && !(state.q && isNavigationalSearch(state.q))
  const candidates = paidAllowed ? sponsoredProducts(state.category) : []
  const placed: Product[] = []
  for (const p of candidates) {
    if (placed.length >= SPONSORED_SLOTS.length) break
    const slot = SPONSORED_SLOTS[placed.length]
    const organicIndex = results.findIndex((x) => x.id === p.id)
    if (organicIndex === -1 || organicIndex <= slot) continue
    if (productStock(p) === 0) continue
    if (placed.some((x) => x.brandId === p.brandId)) continue
    placed.push(p)
  }
  // A page is PAGE_SIZE cards; the sponsored ones count towards it (2 of the first 24).
  const merged: ListingEntry[] = withSponsoredSlots(
    results.filter((p) => !placed.includes(p)),
    placed,
    SPONSORED_SLOTS,
  )
  const all = planCycles(merged, !source && !state.q)
  const pages = Math.max(1, all.length)
  const page = Math.min(state.page, pages)
  const cycles = all.slice(0, page)
  const last = cycles.at(-1)
  // A later cycle's spotlight pulls pieces from further down, so the next page can add more than 24.
  const next = all[page]
  return {
    total: results.length,
    cycles,
    /** Cards in the grid so far; the next page's cards start at this index. */
    cardCount: last ? last.start + last.entries.length : 0,
    /** Pieces on screen so far, spotlight pieces included. */
    shown: cycles.reduce((n, c) => n + c.entries.length + (c.spotlight?.products.length ?? 0), 0),
    page,
    pages,
    hasMore: page < pages,
    /** Pieces the next "Load more" adds: its cards plus its spotlight's pieces (0 on the last page). */
    nextCount: next ? next.entries.length + (next.spotlight?.products.length ?? 0) : 0,
    brandCount: new Set(results.map((p) => p.brandId)).size,
  }
}

export type Listing = ReturnType<typeof buildListing>
