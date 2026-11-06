import { ordersMineQuery } from "@/lib/api/contracts/inbox"
import { route } from "@/server/http/route"
import { ordersMine } from "@/server/inbox/service"

/** GET /api/orders/mine?brand={brandId}: the shopper's own orders with one brand, for Order help (§6.2). */
export const GET = route({ auth: "shopper", query: ordersMineQuery, rate: { key: "orders.mine", limit: 120, windowSec: 60 } }, async ({ actor, query }) => ({ items: await ordersMine(actor.userId, query.brand) }))
