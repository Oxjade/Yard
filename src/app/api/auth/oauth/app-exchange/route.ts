import { oauthAppExchangeBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { exchangeAppHandoff } from "@/server/auth/oauth/app-exchange"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/oauth/app-exchange { code, verifier }   (Origin: <site>, X-Yard-Client: 1, Content-Type: application/json)
 *
 * The native app's end of a Custom Tab sign-in: `code` from yard://auth/complete, `verifier` the
 * secret whose base64url(sha256) the app sent to …/app-start as `challenge`. Opens the session
 * exactly like a browser sign-in (Set-Cookie yard_s for a shopper, yard_b for a brand; __Host-
 * prefixed on https) and answers
 *   200 { status: "signed_in", result: "signed_in", isNew, provider, actor, profile }
 * where `profile` is the same narrow profile GET /api/session returns for that actor (call
 * GET /api/session afterwards for the full picture). isNew: this sign-in created the account (ask
 * "shop or sell"). App sign-ins are shopper or brand only, so MFA never applies.
 * 400 invalid_code: unknown, used, expired, or the verifier doesn't match. 429 when rate limited (30 tries per IP per 10 minutes, as for email links).
 */
export const POST = route({ auth: "public", body: oauthAppExchangeBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => exchangeAppHandoff(body, metaOf(req, ipHash)))
