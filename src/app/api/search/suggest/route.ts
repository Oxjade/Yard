import type { CurrencyCode } from "@/config/markets"
import { normalizeSearchQuery, suggestQuery } from "@/server/follows/contracts"
import { suggest } from "@/server/search"
import { route } from "@/server/http/route"

/**
 * GET /api/search/suggest?q=: type-ahead (up to 6 products, 4 brands). With `scoped=1` and a
 * listing's filters (category, subcategory, brandHandles, sizes, country, min, max, currency,
 * inStock: the same names as /api/search), `terms` gives each completion's count within them.
 */
export const GET = route({ auth: "public", query: suggestQuery, rate: { key: "search.suggest", limit: 300, windowSec: 60, anonGlobal: 12000 }, cache: { public: 30, swr: 120 } }, async ({ query }) =>
  suggest(
    query.q,
    query.scoped
      ? {
          category: query.category,
          subcategory: query.subcategory,
          country: query.country,
          ...normalizeSearchQuery(query),
          currency: query.currency as CurrencyCode,
          inStock: query.inStock,
        }
      : undefined,
  ),
)
