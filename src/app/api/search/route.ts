import type { CurrencyCode } from "@/config/markets"
import { searchQuery } from "@/server/follows/contracts"
import { searchCatalog } from "@/server/search"
import { route } from "@/server/http/route"

/**
 * GET /api/search?q=&category=&brandIds=&minPrice=&maxPrice=&currency=&inStock=&sort=&limit=&cursor=
 * Full-text product search with facets (category, brand, price buckets) in the shopper's currency.
 * minPrice/maxPrice are minor units of `currency`. Brand matches come back in `brands` on the first page.
 */
export const GET = route({ auth: "public", query: searchQuery, rate: { key: "search", limit: 120, windowSec: 60, anonGlobal: 6000 }, cache: { public: 30, swr: 120 } }, async ({ query }) =>
  searchCatalog({
    q: query.q,
    category: query.category,
    brandIds: query.brandIds,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    currency: query.currency as CurrencyCode,
    inStock: query.inStock,
    sort: query.sort,
    limit: query.limit,
    offset: query.cursor ? Number(query.cursor) : 0,
  }),
)
