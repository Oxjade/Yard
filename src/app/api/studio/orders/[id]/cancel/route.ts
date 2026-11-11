import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { cancelOrder, orderDetail } from "@/server/orders"
import { assertBrandMoneyReauth, isCapturedPayment, pathId } from "@/server/orders/access"
import { brandCancelBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/studio/orders/{id}/cancel (orders.fulfil). Before dispatch only; a paid order is
 * refunded in full (PAYMENTS → LEDGER) and restocked unless restock is false. Audited.
 * Cancelling a paid order needs the password re-confirmed within 5 minutes (403 fields.reauth);
 * an unpaid one refunds nothing, so it doesn't.
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: brandCancelBody, maxBody: 4 * 1024, rate: { key: "studio.order_cancel", limit: 30, windowSec: 60 } },
  async ({ actor, params, body }) => {
    const id = pathId(params.id)
    const before = await orderDetail("brand", id, { brandId: actor.brandId })
    if (isCapturedPayment(before.states.payment) && before.states.fulfilment !== "cancelled") await assertBrandMoneyReauth(actor)
    const result = await withTx((tx) => cancelOrder(tx, { orderRefId: id, brandId: actor.brandId, actor: orderActor(actor), reason: body.reason, restock: body.restock, idempotencyKey: body.idempotencyKey }))
    return { ...result, order: await orderDetail("brand", id, { brandId: actor.brandId }) }
  },
)
