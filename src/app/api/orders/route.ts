import { route } from "@/server/http/route"
import { ordersListQuery } from "@/server/orders/contracts"
import { shopperOrders } from "@/server/orders"

/** GET /api/orders?before=&limit= (shopper): the signed-in shopper's orders, newest first, from any device. */
export const GET = route({ auth: "shopper", query: ordersListQuery, rate: { key: "orders.list", limit: 120, windowSec: 60 } }, async ({ actor, query }) => shopperOrders(actor.userId, query))
