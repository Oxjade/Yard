import { liveActivityTokenBody, liveActivityTokenDeleteBody } from "@/lib/api/contracts/notifications"
import { db } from "@/server/db"
import { notFound } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { registerUpdateToken, removeToken, type Db } from "@/server/push/live-activity-db"
import { shopperOrder } from "@/server/shipping/orders"

/**
 * The iOS order-tracking Live Activity's APNs push token (docs/APP.md › Live Activity push).
 * Shopper session, own orders only: another shopper's order, an unknown or malformed id is 404.
 *
 * POST   /api/orders/{id}/live-activity { token (hex), timeZone?, appVersion? }  → 204
 *        Stores the token for this order; a token seen before moves here (ActivityKit rotates them).
 * DELETE /api/orders/{id}/live-activity { token }  → 204 (the activity ended on the phone)
 */
const rate = { key: "orders.live_activity", limit: 30, windowSec: 600 }

export const POST = route({ auth: "shopper", body: liveActivityTokenBody, maxBody: 4 * 1024, rate }, async ({ actor, params, body }) => {
  const order = await shopperOrder(actor, params.id)
  if (!(await registerUpdateToken((await db()) as unknown as Db, actor.userId, order.id, body))) throw notFound()
  return noContent()
})

export const DELETE = route({ auth: "shopper", body: liveActivityTokenDeleteBody, maxBody: 4 * 1024, rate }, async ({ actor, params, body }) => {
  const order = await shopperOrder(actor, params.id)
  await removeToken((await db()) as unknown as Db, actor.userId, body.token, { orderRefId: order.id })
  return noContent()
})
