import { z } from "zod"
import { MODERATION_BATCH_MAX, setProductsModeration } from "@/server/catalog"
import { refuseSampleProduct } from "@/server/catalog/sample-guard"
import { route } from "@/server/http/route"

const body = z.strictObject({ productIds: z.array(z.string().min(1).max(100)).min(1).max(MODERATION_BATCH_MAX), hidden: z.boolean(), reason: z.string().trim().min(1).max(500) })

/**
 * POST /api/admin/catalog/products/moderation { productIds, hidden, reason }: hide or un-hide several
 * products in one decision (Admin › Products bulk Restrict / Lift). All or nothing; each product is
 * audited; each brand gets one email covering its listings, not one per listing.
 */
export const POST = route({ auth: "admin", permission: "content.moderate", body, rate: { key: "admin.product_moderation", limit: 240, windowSec: 3600 } }, async ({ actor, body, ipHash }) => {
  // Production: a sample product isn't on Yard, so there is nothing to moderate (404).
  for (const id of body.productIds) refuseSampleProduct(id)
  return setProductsModeration(actor, { productIds: body.productIds, hidden: body.hidden, reason: body.reason, ipHash })
})
