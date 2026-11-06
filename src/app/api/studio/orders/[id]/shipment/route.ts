import { shipmentEventBody } from "@/lib/api/contracts/shipping"
import { requireBrandResource } from "@/server/auth/dal"
import { json, route } from "@/server/http/route"
import { brandOrderLoader, recordShipment } from "@/server/shipping/orders"

/**
 * POST /api/studio/orders/{id}/shipment (orders.fulfil). The order must belong to the active brand
 * (else 404). Inserts the event, recomputes the estimate, publishes order.estimate to the
 * order's shopper and notifies them (shipped, or running late).
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: shipmentEventBody, rate: { key: "studio.shipment", limit: 300, windowSec: 3600 } },
  async ({ actor, params, body, ipHash }) => {
    const { resource } = await requireBrandResource(brandOrderLoader(params.id), "orders.fulfil")
    return json(await recordShipment(actor, resource, body, ipHash), 201)
  },
)
