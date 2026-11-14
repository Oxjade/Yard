import { pushDeviceBody, pushDeviceDeleteBody } from "@/lib/api/contracts/notifications"
import { getBrandActor, getShopper } from "@/server/auth/dal"
import { unauthenticated } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { registerDevice, removeDevice } from "@/server/push"

/**
 * Push devices for the Yard apps (src/server/push). Either session the app holds counts: the
 * shopper session first, else a brand member's session (Yard setup sessions don't). 401 without one.
 *
 * POST   /api/devices { platform: "android" | "ios", token (≤ 4096), appVersion? }  → 204
 *        Upserts by token: a token another account registered moves to this one; last_seen_at is bumped.
 * DELETE /api/devices { token }  → 204 (removes it only if it is the caller's; call it before signing out)
 *
 * JSON + CSRF like every write: Origin = the site, X-Yard-Client: 1, Content-Type: application/json.
 */
async function deviceOwner() {
  const shopper = await getShopper()
  if (shopper) return shopper.userId
  const brand = await getBrandActor()
  if (brand && brand.role !== "yard_setup") return brand.userId
  throw unauthenticated()
}

const rate = { key: "push.devices", limit: 30, windowSec: 600 }

export const POST = route({ auth: "public", body: pushDeviceBody, maxBody: 8 * 1024, rate }, async ({ body }) => {
  await registerDevice(await deviceOwner(), { platform: body.platform, token: body.token, appVersion: body.appVersion ?? null })
  return noContent()
})

export const DELETE = route({ auth: "public", body: pushDeviceDeleteBody, maxBody: 8 * 1024, rate }, async ({ body }) => {
  await removeDevice(await deviceOwner(), body.token)
  return noContent()
})
