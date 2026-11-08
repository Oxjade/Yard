import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { decideReturn, orderDetail } from "@/server/orders"
import { pathId } from "@/server/orders/access"
import { adminReturnDecisionBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/orders/admin/{id}/returns/{returnId}/decision (admin, shipping.resolve): a platform
 * decision on a return; Yard may approve a return the brand declined. Audited.
 */
export const POST = route(
  { auth: "admin", permission: "shipping.resolve", body: adminReturnDecisionBody, maxBody: 4 * 1024, rate: { key: "admin.return_decision", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const id = pathId(params.id)
    const r = await withTx((tx) => decideReturn(tx, { orderRefId: id, returnId: pathId(params.returnId), actor: orderActor(actor), decision: body.decision, reason: body.reason, ipHash }))
    return { ...r, order: await orderDetail("admin", id, {}) }
  },
)
