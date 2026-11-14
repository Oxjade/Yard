import { confirmEmailChange } from "@/server/auth/account"
import { tokenBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/change-email/confirm { token } (posted by the /auth/change-email page, never a
 * GET; no session needed) → { status: "changed", email }. 400 for an expired, used or stale link;
 * 409 when the address now belongs to another account.
 */
export const POST = route({ auth: "public", body: tokenBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => confirmEmailChange(body.token, metaOf(req, ipHash)))
