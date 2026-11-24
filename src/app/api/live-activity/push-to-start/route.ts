import { liveActivityTokenBody, liveActivityTokenDeleteBody } from "@/lib/api/contracts/notifications"
import { db } from "@/server/db"
import { noContent, route } from "@/server/http/route"
import { registerStartToken, removeToken, type Db } from "@/server/push/live-activity-db"

/**
 * The phone's ActivityKit push-to-start token (iOS 17.2+; docs/APP.md › Live Activity push): when
 * one of the shopper's orders first ships and no activity is tracking it yet, Yard starts one.
 * Shopper session only.
 *
 * POST   /api/live-activity/push-to-start { token (hex), timeZone?, appVersion? }  → 204
 * DELETE /api/live-activity/push-to-start { token }  → 204 (only the caller's; call it before signing out)
 */
const rate = { key: "live_activity.start_token", limit: 20, windowSec: 600 }

export const POST = route({ auth: "shopper", body: liveActivityTokenBody, maxBody: 4 * 1024, rate }, async ({ actor, body }) => {
  await registerStartToken((await db()) as unknown as Db, actor.userId, body)
  return noContent()
})

export const DELETE = route({ auth: "shopper", body: liveActivityTokenDeleteBody, maxBody: 4 * 1024, rate }, async ({ actor, body }) => {
  await removeToken((await db()) as unknown as Db, actor.userId, body.token, { kind: "start" })
  return noContent()
})
