import { requireBrandResource } from "@/server/auth/dal"
import { route } from "@/server/http/route"
import { brandOrderLoader, deliveryFor } from "@/server/shipping/orders"

/** GET /api/studio/orders/{id}/delivery (inbox.read, 120 a minute per member): the active brand's order only (else 404). */
export const GET = route({ auth: "brand", permission: "inbox.read", rate: { key: "studio.delivery", limit: 120, windowSec: 60 } }, async ({ params }) => {
  const { resource } = await requireBrandResource(brandOrderLoader(params.id), "inbox.read")
  return deliveryFor(resource, "brand")
})
