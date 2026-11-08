import { withTx } from "@/server/db"
import { json, route } from "@/server/http/route"
import { issueRefund, orderDetail } from "@/server/orders"
import { assertAdminRecentReauth, pathId } from "@/server/orders/access"
import { refundBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/orders/admin/{id}/refunds (admin, shipping.resolve, recent re-auth): a platform refund
 * (e.g. a delivery problem Yard resolved for the shopper). Same cap and idempotency as brand refunds. Audited.
 */
export const POST = route(
  { auth: "admin", permission: "shipping.resolve", body: refundBody, maxBody: 4 * 1024, rate: { key: "admin.refund", limit: 20, windowSec: 60 } },
  async ({ actor, params, body }) => {
    await assertAdminRecentReauth(actor)
    const id = pathId(params.id)
    const r = await withTx((tx) => issueRefund(tx, { orderRefId: id, amountMinor: body.amountMinor, reason: body.reason, kind: "platform", idempotencyKey: body.idempotencyKey, actor: orderActor(actor) }))
    return json({ refundId: r.refund.id, status: r.refund.status, duplicate: r.duplicate, order: await orderDetail("admin", id, {}) }, r.duplicate ? 200 : 201)
  },
)
