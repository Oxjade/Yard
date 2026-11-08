import { route } from "@/server/http/route"
import { checkoutOrders } from "@/server/orders"
import { pathId } from "@/server/orders/access"

/** GET /api/orders/checkouts/{checkoutId} (shopper, own checkout only, else 404): the orders one checkout created, for the receipt. */
export const GET = route({ auth: "shopper", rate: { key: "orders.checkout", limit: 120, windowSec: 60 } }, async ({ actor, params }) => checkoutOrders(actor.userId, pathId(params.checkoutId)))
