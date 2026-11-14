import { accountOf, changeName } from "@/server/auth/account"
import { accountNameBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { route } from "@/server/http/route"

/**
 * GET /api/account?as=shopper|brand → { account: AccountDto }: the signed-in person's name, email,
 * sign-in methods and any pending email change. A brand member's account is the same person.
 */
export const GET = route({ rate: { key: "account.read", limit: 120, windowSec: 60 }, auth: "multi", as: ["shopper", "brand"] }, async ({ actor }) => ({ account: await accountOf(actor.userId) }))

/** PATCH /api/account?as=shopper|brand { name } → { account }: saved at once (sign-up rules: 1–80 characters, no control characters or < >). */
export const PATCH = route({ rate: { key: "account.name", limit: 20, windowSec: 600 }, auth: "multi", as: ["shopper", "brand"], body: accountNameBody, maxBody: 2 * 1024 }, async ({ req, actor, body, ipHash }) => ({
  account: await changeName(actor as Parameters<typeof changeName>[0], body.name, metaOf(req, ipHash)),
}))
