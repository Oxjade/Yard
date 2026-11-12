import { mfaResetBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { resetAdminMfa } from "@/server/auth/mfa"
import { requireRecentReauth } from "@/server/auth/reauth"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/mfa/reset { userId, reason } (owner admins only, re-auth in the last 5 minutes).
 * Removes another admin's TOTP and recovery codes and ends their admin sessions; they enrol again
 * at their next sign-in. Audited as admin.mfa_reset.
 */
export const POST = route({ rate: { key: "auth.mfa.reset", limit: 10, windowSec: 600 }, auth: "admin", permission: "any_admin", body: mfaResetBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) => {
  await requireRecentReauth(actor, 300)
  return resetAdminMfa(actor, body.userId, body.reason, metaOf(req, ipHash))
})
