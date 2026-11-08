import { reauthBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { reauthenticate } from "@/server/auth/reauth"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/reauth?as=shopper|brand|admin { password } | { code } | { recoveryCode } | { demo: true }
 *  → { ok: true, method }. Call it when an action answered 403 with fields.reauth = "required",
 * then retry the action. Admins confirm with TOTP; shoppers and brand members with their password
 * (OAuth-only accounts use POST /api/auth/oauth/{provider}/start with mode "reauth").
 * `demo: true` works only for demo sessions in development.
 */
export const POST = route({ auth: "multi", as: ["shopper", "brand", "admin"], body: reauthBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) => reauthenticate(actor, body, metaOf(req, ipHash)))
