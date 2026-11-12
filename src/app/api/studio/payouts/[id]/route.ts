import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { assertBrandFinanceView } from "@/server/ledger/access"
import { getPayout } from "@/server/ledger/read"

/** GET /api/studio/payouts/{id}: one of the active brand's payouts (another brand's is 404). */
export const GET = route({ rate: { key: "payouts.read", limit: 120, windowSec: 60 }, auth: "brand", permission: "any_member" }, async ({ actor, params }) => {
  assertBrandFinanceView(actor)
  const payout = await getPayout(params.id, actor.brandId)
  if (!payout) throw notFound("We couldn't find that payout.")
  return { payout }
})
