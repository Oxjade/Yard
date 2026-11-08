import { changePasswordBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { changePassword, credentialsOf } from "@/server/auth/identity"
import { requireRecentReauth } from "@/server/auth/reauth"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/password/change?as=shopper|brand { currentPassword?, newPassword }. The current
 * password is required when one is set. An account without one (Google/Apple, magic link, invite)
 * sets its first password here only after a recent re-auth (≤ 5 min: the OAuth `reauth` round
 * trip, or the fresh sign-in itself), so a borrowed session cookie can't plant a password and
 * lock the owner out. Ends the account's other sessions.
 */
export const POST = route({ auth: "multi", as: ["shopper", "brand"], body: changePasswordBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) => {
  // Demo accounts are refused by changePassword (422) either way.
  if (!actor.demo && !(await credentialsOf(actor.userId))?.passwordHash) await requireRecentReauth(actor, 300)
  return changePassword({ userId: actor.userId, sessionId: actor.sessionId, current: body.currentPassword ?? null, next: body.newPassword }, metaOf(req, ipHash))
})
