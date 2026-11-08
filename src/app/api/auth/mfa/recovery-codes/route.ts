import { metaOf } from "@/server/auth/http"
import { regenerateRecoveryCodes } from "@/server/auth/mfa"
import { requireRecentReauth } from "@/server/auth/reauth"
import { route } from "@/server/http/route"

/** POST /api/auth/mfa/recovery-codes → { recoveryCodes } (replaces all; needs a re-auth in the last 5 minutes). */
export const POST = route({ auth: "admin", permission: "any_admin" }, async ({ req, actor, ipHash }) => {
  await requireRecentReauth(actor, 300)
  return regenerateRecoveryCodes(actor, metaOf(req, ipHash))
})
