import { cancelEmailChange, requestEmailChange } from "@/server/auth/account"
import { accountEmailBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { route } from "@/server/http/route"

/**
 * POST /api/account/email?as=shopper|brand { email, currentPassword? } → { account } with
 * `pendingEmail` set. Sends a confirmation link to the NEW address; the email changes only when
 * it is opened (POST /api/auth/change-email/confirm). An account without a password needs a
 * recent re-auth instead (403 forbidden, fields.reauth = "required").
 */
export const POST = route({ rate: { key: "account.email", limit: 10, windowSec: 3600 }, auth: "multi", as: ["shopper", "brand"], body: accountEmailBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) => ({
  account: await requestEmailChange(actor as Parameters<typeof requestEmailChange>[0], body, metaOf(req, ipHash)),
}))

/** DELETE /api/account/email?as=shopper|brand → { account } with `pendingEmail: null`: the link already sent stops working. */
export const DELETE = route({ rate: { key: "account.email.cancel", limit: 30, windowSec: 600 }, auth: "multi", as: ["shopper", "brand"] }, async ({ actor }) => ({
  account: await cancelEmailChange(actor as Parameters<typeof cancelEmailChange>[0]),
}))
