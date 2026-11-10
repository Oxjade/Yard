import type { CurrencyCode } from "@/config/markets"
import { normalizeSearchQuery, searchQuery } from "@/server/follows/contracts"
import { searchCatalog } from "@/server/search"
import { route } from "@/server/http/route"

/**
 * GET /api/search?q=&category=&brand=&min=&max=&currency=&inStock=&sort=&limit=&cursor=
 * Full-text product search with facets (category, brand, price buckets) in the shopper's currency.
 * `brand` is one brand ID; `min` and `max` are minor units of `currency`. Legacy `brandIds`, `minPrice`,
 * and `maxPrice` names remain accepted. Brand matches come back in `brands` on the first page.
 */
export const GET = route({ auth: "public", query: searchQuery, rate: { key: "search", limit: 120, windowSec: 60, anonGlobal: 6000 }, cache: { public: 30, swr: 120 } }, async ({ query }) => {
  const filters = normalizeSearchQuery(query)
  return searchCatalog({
    q: query.q,
    category: query.category,
    ...filters,
    currency: query.currency as CurrencyCode,
    inStock: query.inStock,
    sort: query.sort,
    limit: query.limit,
    offset: query.cursor ? Number(query.cursor) : 0,
  })
})
