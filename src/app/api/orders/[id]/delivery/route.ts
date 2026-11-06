import { route } from "@/server/http/route"
import { deliveryFor, shopperOrder } from "@/server/shipping/orders"

/** GET /api/orders/{id}/delivery (shopper, owner only; another shopper's order is 404): estimate, shipment events and any delivery problem. */
export const GET = route({ auth: "shopper", rate: { key: "orders.delivery", limit: 120, windowSec: 60 } }, async ({ actor, params }) => deliveryFor(await shopperOrder(actor, params.id)))
