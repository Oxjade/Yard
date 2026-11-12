import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { getPayout, statement } from "@/server/ledger/read"

/** GET /api/admin/finance/payouts/{id}: the payout, its approvals, and the brand's recent ledger lines. */
export const GET = route({ rate: { key: "finance.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "any_admin" }, async ({ actor, params }) => {
  assertAdminFinance(actor)
  const payout = await getPayout(params.id)
  if (!payout) throw notFound("We couldn't find that payout.")
  const entries = await statement({ ownerKind: "brand", ownerId: payout.brandId, currency: payout.currency, limit: 50 })
  return { payout, entries }
})
