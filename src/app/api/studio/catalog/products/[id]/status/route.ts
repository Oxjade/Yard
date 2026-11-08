import { route } from "@/server/http/route"
import { productPublishBody } from "@/server/catalog/contracts"
import { idParam } from "@/server/catalog/params"
import { setProductStatus } from "@/server/catalog/studio"

/**
 * POST /api/studio/catalog/products/{id}/status (content.publish): action publish | schedule
 * (with publishAt, 1 minute to 1 year ahead; the publishScheduled job flips it) | unpublish |
 * archive | restore, with expectedVersion. Publishing needs a variant and a photo, a brand that
 * isn't restricted or under review, and a product moderation hasn't hidden.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: productPublishBody, rate: { key: "studio.catalog.status", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => setProductStatus(actor, idParam(params, "id"), body, ipHash),
)
