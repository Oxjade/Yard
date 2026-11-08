import { route } from "@/server/http/route"
import { publicProductsQuery } from "@/server/catalog/contracts"
import { listPublicProducts } from "@/server/catalog/public"

/**
 * GET /api/catalog/products (public; 120 a minute per IP). Published, non-hidden products of
 * listed brands. Filters: brand (id or handle), category, subcategory, collection (id or handle),
 * tag, drop, ids (repeat ids=), inStock=1; sort new | price_asc | price_desc | title; limit/offset.
 * Prices are integer minor units in the product's currency.
 */
export const GET = route(
  { auth: "public", query: publicProductsQuery, rate: { key: "catalog.products", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 30, swr: 60 } },
  async ({ query }) => listPublicProducts(query),
)
