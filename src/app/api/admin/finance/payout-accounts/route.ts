import { adminPayoutAccountsQuery } from "@/lib/api/contracts/admin-payout-accounts"
import { listPayoutAccounts } from "@/server/admin/payout-accounts"
import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"

/**
 * GET /api/admin/finance/payout-accounts?q=&status=all|missing|pending|verified&page=&pageSize=
 * (Owner and Finance roles, like the rest of Finance): every brand with its payout account status
 * (none / pending / verified), the bank, account name and last 4 digits (never the number), when
 * it was added or changed, and whether the brand can sell. → { items, total, page, pageSize, counts }.
 */
export const GET = route(
  { rate: { key: "finance.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "any_admin", query: adminPayoutAccountsQuery, cache: "no-store" },
  async ({ actor, query }) => {
    assertAdminFinance(actor)
    return listPayoutAccounts(query)
  },
)
