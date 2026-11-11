import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { orderDetail, receiveReturn } from "@/server/orders"
import { assertBrandMoneyReauth, isCapturedPayment, pathId } from "@/server/orders/access"
import { returnReceiveBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/studio/orders/{id}/returns/{returnId}/receive (orders.fulfil): the parcel came back.
 * Restocks (default) and refunds the computed amount (default; a lower amountMinor is allowed,
 * never more). Idempotent: receiving twice returns the first result. Audited.
 * Receiving with a refund on a paid order needs the password re-confirmed within 5 minutes
 * (403 fields.reauth); receiving with refund: false doesn't.
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: returnReceiveBody, maxBody: 4 * 1024, rate: { key: "studio.return_receive", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const id = pathId(params.id)
    const returnId = pathId(params.returnId)
    if (body.refund !== false) {
      const before = await orderDetail("brand", id, { brandId: actor.brandId })
      const ret = before.returns.find((x) => x.id === returnId)
      // Only when this call would actually refund: a received, declined or closed return answers without moving money.
      if (isCapturedPayment(before.states.payment) && (ret?.status === "approved" || ret?.status === "requested")) await assertBrandMoneyReauth(actor)
    }
    const r = await withTx((tx) => receiveReturn(tx, { orderRefId: id, returnId, brandId: actor.brandId, actor: orderActor(actor), ipHash, ...body }))
    return { ...r, order: await orderDetail("brand", id, { brandId: actor.brandId }) }
  },
)
