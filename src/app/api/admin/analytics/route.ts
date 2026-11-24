import { route } from "@/server/http/route"
import { adminAnalytics, analyticsDaysQuery } from "@/server/analytics"
import { assertAdminFinance } from "@/server/ledger/access"

/** GET /api/admin/analytics?days=7|30|90 (Owner and Finance): GMV, commission, top brands, payouts and payment success per currency, memoised five minutes. */
export const GET = route({ auth: "admin", permission: "any_admin", query: analyticsDaysQuery, rate: { key: "admin.analytics", limit: 120, windowSec: 60 } }, async ({ actor, query }) => {
  assertAdminFinance(actor)
  return adminAnalytics(query.days as 7 | 30 | 90)
})
