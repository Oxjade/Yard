import { suggestQuery } from "@/server/follows/contracts"
import { suggest } from "@/server/search"
import { route } from "@/server/http/route"

/** GET /api/search/suggest?q=: type-ahead (up to 6 products, 4 brands). */
export const GET = route({ auth: "public", query: suggestQuery, rate: { key: "search.suggest", limit: 300, windowSec: 60, anonGlobal: 12000 }, cache: { public: 30, swr: 120 } }, async ({ query }) => suggest(query.q))
