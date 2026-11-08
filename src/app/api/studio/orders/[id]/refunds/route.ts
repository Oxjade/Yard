import { withTx } from "@/server/db"
import { json, route } from "@/server/http/route"
import { issueRefund, orderDetail } from "@/server/orders"
import { assertBrandMayRefund, pathId } from "@/server/orders/access"
import { refundBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/studio/orders/{id}/refunds (orders.fulfil + owner/admin role). A goodwill or partial
 * refund. Never more than what's left (422); idempotent per key (200 with duplicate: true).
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: refundBody, maxBody: 4 * 1024, rate: { key: "studio.refund", limit: 20, windowSec: 60, daily: 200 } },
  async ({ actor, params, body }) => {
    assertBrandMayRefund(actor)
    const id = pathId(params.id)
    const r = await withTx((tx) => issueRefund(tx, { orderRefId: id, brandId: actor.brandId, amountMinor: body.amountMinor, reason: body.reason, kind: "goodwill", idempotencyKey: body.idempotencyKey, actor: orderActor(actor) }))
    return json({ refundId: r.refund.id, status: r.refund.status, duplicate: r.duplicate, order: await orderDetail("brand", id, { brandId: actor.brandId }) }, r.duplicate ? 200 : 201)
  },
)
