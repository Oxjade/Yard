import { route } from "@/server/http/route"
import { brandOrders } from "@/server/orders"
import { brandOrdersQuery } from "@/server/orders/contracts"

/** GET /api/studio/orders?before=&limit=&payment=&fulfilment=&returns=&q= (any member): the active brand's orders, newest first. */
export const GET = route({ auth: "brand", permission: "any_member", query: brandOrdersQuery, rate: { key: "studio.orders", limit: 120, windowSec: 60 } }, async ({ actor, query }) => brandOrders(actor.brandId, query))
