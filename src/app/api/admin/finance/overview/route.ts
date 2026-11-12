import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { financeOverview } from "@/server/ledger/read"

/** GET /api/admin/finance/overview: platform balances, brand liabilities per currency and the payout queue. */
export const GET = route({ rate: { key: "finance.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "any_admin" }, async ({ actor }) => {
  assertAdminFinance(actor)
  return financeOverview()
})
