import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { orderDetail, receiveReturn } from "@/server/orders"
import { pathId } from "@/server/orders/access"
import { returnReceiveBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/studio/orders/{id}/returns/{returnId}/receive (orders.fulfil): the parcel came back.
 * Restocks (default) and refunds the computed amount (default; a lower amountMinor is allowed,
 * never more). Idempotent: receiving twice returns the first result. Audited.
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: returnReceiveBody, maxBody: 4 * 1024, rate: { key: "studio.return_receive", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const id = pathId(params.id)
    const r = await withTx((tx) => receiveReturn(tx, { orderRefId: id, returnId: pathId(params.returnId), brandId: actor.brandId, actor: orderActor(actor), ipHash, ...body }))
    return { ...r, order: await orderDetail("brand", id, { brandId: actor.brandId }) }
  },
)
