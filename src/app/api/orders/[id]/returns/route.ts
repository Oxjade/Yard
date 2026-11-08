import { withTx } from "@/server/db"
import { json, route } from "@/server/http/route"
import { orderDetail, requestReturn } from "@/server/orders"
import { pathId } from "@/server/orders/access"
import { returnRequestBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"

/**
 * POST /api/orders/{id}/returns (shopper, owner only). Delivered orders within the return window;
 * one open return per order; lines omitted = everything not yet returned. Idempotent per key
 * (200 with duplicate: true on a retry).
 */
export const POST = route(
  { auth: "shopper", body: returnRequestBody, maxBody: 16 * 1024, rate: { key: "orders.return", limit: 10, windowSec: 60, daily: 10 } },
  async ({ actor, params, body }) => {
    const id = pathId(params.id)
    const r = await withTx((tx) => requestReturn(tx, { orderRefId: id, customerId: actor.userId, actor: orderActor(actor), lines: body.lines, reason: body.reason, note: body.note, idempotencyKey: body.idempotencyKey }))
    return json({ ...r, order: await orderDetail("shopper", id, { customerId: actor.userId }) }, r.duplicate ? 200 : 201)
  },
)
