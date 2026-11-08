import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { decideReturn, orderDetail } from "@/server/orders"
import { pathId } from "@/server/orders/access"
import { returnDecisionBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/** POST /api/studio/orders/{id}/returns/{returnId}/decision (orders.fulfil): approve or decline (with a reason) a requested return. Audited. */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: returnDecisionBody, maxBody: 4 * 1024, rate: { key: "studio.return_decision", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const id = pathId(params.id)
    const r = await withTx((tx) => decideReturn(tx, { orderRefId: id, returnId: pathId(params.returnId), brandId: actor.brandId, actor: orderActor(actor), decision: body.decision, reason: body.reason, ipHash }))
    return { ...r, order: await orderDetail("brand", id, { brandId: actor.brandId }) }
  },
)
