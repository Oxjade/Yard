import { z } from "zod"
import { setProductModeration } from "@/server/catalog"
import { refuseSampleProduct } from "@/server/catalog/sample-guard"
import { route } from "@/server/http/route"

const body = z.strictObject({ hidden: z.boolean(), reason: z.string().trim().min(1).max(500) })

/** POST /api/admin/catalog/products/{id}/moderation { hidden, reason }: hide or un-hide a product everywhere public. Audited. */
export const POST = route({ auth: "admin", permission: "content.moderate", body, rate: { key: "admin.product_moderation", limit: 240, windowSec: 3600 } }, async ({ actor, params, body, ipHash }) => {
  // Production: a sample product isn't on Yard, so there is nothing to moderate (404).
  refuseSampleProduct(params.id)
  return setProductModeration(actor, { productId: params.id, hidden: body.hidden, reason: body.reason, ipHash })
})
