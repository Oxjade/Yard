import { route, json } from "@/server/http/route"
import { productCreateBody, studioProductsQuery } from "@/server/catalog/contracts"
import { createProduct, listStudioProducts } from "@/server/catalog/studio"

/** GET /api/studio/catalog/products (any member): the active brand's products, any status, with stock counters. Filters: status, q (title or SKU), collectionId, lowStock=1; limit/offset. */
export const GET = route({ auth: "brand", permission: "any_member", query: studioProductsQuery, rate: { key: "studio.catalog.list", limit: 120, windowSec: 60 } }, async ({ actor, query }) => listStudioProducts(actor, query))

/**
 * POST /api/studio/catalog/products (content.publish): creates a draft product with options,
 * variants (optional opening stock, written as stock movements), photos (brand uploads) and
 * collections. Currency is the brand's. 201 with the Studio product.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: productCreateBody, maxBody: 256 * 1024, rate: { key: "studio.catalog.create", limit: 30, windowSec: 60, daily: 500 } },
  async ({ actor, body, ipHash }) => json(await createProduct(actor, body, ipHash), 201),
)
