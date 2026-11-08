import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { cancelOrder, orderDetail } from "@/server/orders"
import { pathId } from "@/server/orders/access"
import { cancelOrderBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/orders/{id}/cancel (shopper, owner only). Before dispatch only (422 after). A paid
 * order is refunded in full and restocked. Idempotent: cancelling again returns the same order.
 */
export const POST = route(
  { auth: "shopper", body: cancelOrderBody, maxBody: 4 * 1024, rate: { key: "orders.cancel", limit: 10, windowSec: 60, daily: 20 } },
  async ({ actor, params, body }) => {
    const id = pathId(params.id)
    const result = await withTx((tx) => cancelOrder(tx, { orderRefId: id, customerId: actor.userId, actor: orderActor(actor), reason: body.reason?.trim() || "Cancelled by the shopper", restock: true, idempotencyKey: body.idempotencyKey }))
    return { ...result, order: await orderDetail("shopper", id, { customerId: actor.userId }) }
  },
)
