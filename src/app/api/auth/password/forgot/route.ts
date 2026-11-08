import { emailOnlyBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { requestPasswordReset } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/** POST /api/auth/password/forgot { email } → { ok: true } whether or not the account exists. */
export const POST = route({ auth: "public", body: emailOnlyBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => requestPasswordReset(body.email, metaOf(req, ipHash)))
