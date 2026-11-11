import { route } from "@/server/http/route"
import { publicBrandsQuery } from "@/server/catalog/contracts"
import { listPublicBrands } from "@/server/catalog/public"

/**
 * GET /api/catalog/brands (public; 120 a minute per IP). Listed brands on the server, never the
 * bundled sample brands. Filters: q (name, handle or city), category, country (ISO), founding=1|0,
 * exclude (id or handle); sort name | new; limit/offset (nextOffset pages on).
 */
export const GET = route(
  { auth: "public", query: publicBrandsQuery, rate: { key: "catalog.brands", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 30, swr: 60 } },
  async ({ query }) => listPublicBrands(query),
)
