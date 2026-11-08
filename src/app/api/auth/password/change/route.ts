import { changePasswordBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { changePassword } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/password/change?as=shopper|brand { currentPassword?, newPassword }. The current
 * password is required when one is set (OAuth-only accounts set their first one here). Ends the
 * account's other sessions.
 */
export const POST = route({ auth: "multi", as: ["shopper", "brand"], body: changePasswordBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) =>
  changePassword({ userId: actor.userId, sessionId: actor.sessionId, current: body.currentPassword ?? null, next: body.newPassword }, metaOf(req, ipHash)),
)
