import { json, route } from "@/server/http/route"
import { assertBrandFinanceView } from "@/server/ledger/access"
import { requestPayout } from "@/server/ledger/payouts"
import { brandPayoutSummary } from "@/server/ledger/read"
import { requestPayoutBody } from "@/server/ledger/schemas"

/** GET /api/studio/payouts: balances per currency, payout rules, the masked payout account and recent payouts. */
export const GET = route({ auth: "brand", permission: "any_member" }, async ({ actor }) => {
  assertBrandFinanceView(actor)
  return brandPayoutSummary(actor.brandId, actor.brand.currency)
})

/** POST /api/studio/payouts { amountMinor, currency?, idempotencyKey }: requests a payout from the available balance. */
export const POST = route(
  { auth: "brand", permission: "any_member", body: requestPayoutBody, rate: { key: "payouts.request", limit: 10, windowSec: 3600, daily: 20 } },
  async ({ actor, body, ipHash }) => {
    const { payout, created } = await requestPayout(actor, body, ipHash)
    return json({ payout }, created ? 201 : 200)
  },
)
