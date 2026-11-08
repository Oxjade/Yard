import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { cancelReturn, orderDetail } from "@/server/orders"
import { pathId } from "@/server/orders/access"
import { orderActor } from "@/server/orders/core"

/** POST /api/orders/{id}/returns/{returnId}/cancel (shopper, owner only): withdraws a return the brand hasn't decided. */
export const POST = route({ auth: "shopper", rate: { key: "orders.return_cancel", limit: 10, windowSec: 60 } }, async ({ actor, params }) => {
  const id = pathId(params.id)
  const r = await withTx((tx) => cancelReturn(tx, { orderRefId: id, returnId: pathId(params.returnId), customerId: actor.userId, actor: orderActor(actor) }))
  return { ...r, order: await orderDetail("shopper", id, { customerId: actor.userId }) }
})
