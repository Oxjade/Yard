import { route } from "@/server/http/route"
import { orderDetail } from "@/server/orders"
import { pathId } from "@/server/orders/access"

/**
 * GET /api/orders/{id} (shopper, owner only, else 404): the order with its payment, fulfilment,
 * return and dispute states, lines, returns, refunds, timeline, delivery and allowed actions.
 */
export const GET = route({ auth: "shopper", rate: { key: "orders.detail", limit: 240, windowSec: 60 } }, async ({ actor, params }) => ({ order: await orderDetail("shopper", pathId(params.id), { customerId: actor.userId }) }))
