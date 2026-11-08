import { emailOnlyBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { requestEmailVerification } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/** POST /api/auth/verify-email/request { email } → { ok: true } whatever the account state. */
export const POST = route({ auth: "public", body: emailOnlyBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => requestEmailVerification(body.email, metaOf(req, ipHash)))
