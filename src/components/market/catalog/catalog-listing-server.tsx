import { connection } from "next/server"
import { toCatalogProduct } from "@/lib/api/catalog-products"
import type { CategorySlug } from "@/lib/data/types"
import { listPublicProducts } from "@/server/catalog/public"
import { normalizeSearchQuery, searchQuery } from "@/server/follows/contracts"
import { searchCatalog } from "@/server/search"
import { CatalogListing } from "./catalog-listing"
import { CATALOG_SSR_CURRENCY, catalogSearchKey, catalogSearchQuery, parseCatalogParams, type CatalogInitialPage } from "./catalog-state"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * The listing with its first page read on the server from search (the same request the browser
 * would make for page 1, in NGN: the default shopper currency and what the browser renders before
 * hydrating, so the default shopper's key matches and the grid isn't refetched), so the HTML carries
 * products for crawlers, no-JS visitors and first paint. The browser skips that request while the
 * key still matches, and loads further pages itself. If the read fails, the listing loads it all.
 */
export async function CatalogListingServer({ category, searchParams }: { category?: CategorySlug; searchParams: SearchParams }) {
  // Outside the catch: during prerender this suspends the request-time part, which must not be swallowed.
  await connection()
  const initial = await firstPage(category, await searchParams).catch(() => undefined)
  return <CatalogListing category={category} initial={initial} />
}

async function firstPage(category: CategorySlug | undefined, raw: Awaited<SearchParams>): Promise<CatalogInitialPage | undefined> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value
    if (first !== undefined) params.set(key, first)
  }
  const state = parseCatalogParams(params, { category })
  const request = catalogSearchQuery(state, CATALOG_SSR_CURRENCY)
  const key = catalogSearchKey(request)
  const parsed = searchQuery.safeParse(Object.fromEntries(new URLSearchParams(key)))
  if (!parsed.success) return undefined
  const query = parsed.data
  const response = await searchCatalog({
    q: query.q,
    category: query.category,
    subcategory: query.subcategory,
    country: query.country,
    ...normalizeSearchQuery(query),
    currency: CATALOG_SSR_CURRENCY,
    inStock: query.inStock,
    sort: query.sort,
    limit: query.limit,
    offset: 0,
  })
  const ids = response.items.map((item) => item.productId)
  const page = ids.length ? await listPublicProducts({ ids, sort: "new", limit: 60, offset: 0 }) : { products: [] }
  const byId = new Map(page.products.map((row) => [row.id, toCatalogProduct(row)]))
  // In the search's order, as loadPublicProductsByIds keeps it in the browser.
  const products = ids.flatMap((id) => {
    const product = byId.get(id)
    return product ? [product] : []
  })
  const { items, total, brandCount, nextCursor, facets } = response
  return { key, products, response: { items: items.map(({ productId }) => ({ productId })), total, brandCount, nextCursor, facets } }
}
