import { route } from "@/server/http/route"
import { cancelPayout } from "@/server/ledger/payouts"

/** POST /api/studio/payouts/{id}/cancel: cancels a payout still awaiting approval; the funds return to available. */
export const POST = route({ auth: "brand", permission: "any_member", rate: { key: "payouts.cancel", limit: 20, windowSec: 3600 } }, async ({ actor, params, ipHash }) => {
  const payout = await cancelPayout(actor, params.id, ipHash)
  return { payout }
})
