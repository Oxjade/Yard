import { studioPushPreferencesBody } from "@/lib/api/contracts/studio-app"
import { route } from "@/server/http/route"
import { getPushPreferences, setPushPreferences } from "@/server/studio-app"

/** GET /api/studio/settings/notifications (any member) → { push: { orders, messages, lowStock, payouts } }: this member's Studio push choices for the active brand. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.push_prefs", limit: 60, windowSec: 60 } }, async ({ actor }) => getPushPreferences(actor))

/** PUT /api/studio/settings/notifications { push: { orders?, messages?, lowStock?, payouts? } } (any member, their own choices) → the saved choices. */
export const PUT = route(
  { auth: "brand", permission: "any_member", body: studioPushPreferencesBody, maxBody: 1024, rate: { key: "studio.push_prefs.write", limit: 30, windowSec: 60 } },
  async ({ actor, body }) => setPushPreferences(actor, body.push),
)
