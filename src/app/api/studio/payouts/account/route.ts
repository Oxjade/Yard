import { route } from "@/server/http/route"
import { assertBrandFinanceView } from "@/server/ledger/access"
import { savePayoutAccount } from "@/server/ledger/payouts"
import { getPayoutAccount } from "@/server/ledger/read"
import { payoutAccountBody } from "@/server/ledger/schemas"

/** GET /api/studio/payouts/account: the masked payout account (last 4 digits only), or null. */
export const GET = route({ rate: { key: "payouts.read", limit: 120, windowSec: 60 }, auth: "brand", permission: "any_member" }, async ({ actor }) => {
  assertBrandFinanceView(actor)
  return { account: await getPayoutAccount(actor.brandId) }
})

/**
 * PUT /api/studio/payouts/account: owner only, recent re-auth. Creates the transfer recipient
 * (Paystack, or the labelled stub without keys), seals the account number and starts the
 * payout cooldown.
 */
export const PUT = route(
  { auth: "brand", permission: "any_member", body: payoutAccountBody, rate: { key: "payouts.account", limit: 5, windowSec: 3600, daily: 10 } },
  async ({ actor, body, ipHash }) => ({ account: await savePayoutAccount(actor, body, ipHash) }),
)
