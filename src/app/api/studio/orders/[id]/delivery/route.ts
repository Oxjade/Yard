import { requireBrandResource } from "@/server/auth/dal"
import { route } from "@/server/http/route"
import { brandOrderLoader, deliveryFor } from "@/server/shipping/orders"

/** GET /api/studio/orders/{id}/delivery (inbox.read): the active brand's order only (else 404). */
export const GET = route({ auth: "brand", permission: "inbox.read" }, async ({ params }) => {
  const { resource } = await requireBrandResource(brandOrderLoader(params.id), "inbox.read")
  return deliveryFor(resource)
})
