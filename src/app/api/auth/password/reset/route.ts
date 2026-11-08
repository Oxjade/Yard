import { resetPasswordBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { resetPassword } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/password/reset { token, password } → { ok: true }. Ends every session of the
 * account and clears the lockout; the person then signs in with the new password.
 */
export const POST = route({ auth: "public", body: resetPasswordBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => resetPassword(body.token, body.password, metaOf(req, ipHash)))
