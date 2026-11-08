import { tokenBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { confirmEmailVerification } from "@/server/auth/identity"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/verify-email/confirm { token } (posted by the /auth/verify page, never a GET)
 *  → { status: "verified", signedIn: true, actor: "shopper", profile } | { status: "verified", signedIn: false }
 */
export const POST = route({ auth: "public", body: tokenBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => confirmEmailVerification(body.token, metaOf(req, ipHash)))
