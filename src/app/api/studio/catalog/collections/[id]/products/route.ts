import { route } from "@/server/http/route"
import { collectionProductsBody } from "@/server/catalog/contracts"
import { idParam } from "@/server/catalog/params"
import { setCollectionProducts } from "@/server/catalog/studio"

/** PUT /api/studio/catalog/collections/{id}/products (content.publish): replaces the collection's products, in order; every id must be the brand's. */
export const PUT = route(
  { auth: "brand", permission: "content.publish", body: collectionProductsBody, rate: { key: "studio.catalog.collections", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => setCollectionProducts(actor, idParam(params, "id"), body.productIds, ipHash),
)
