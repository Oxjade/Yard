import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { listPayouts } from "@/server/ledger/read"
import { adminPayoutsQuery } from "@/server/ledger/schemas"

/** GET /api/admin/finance/payouts?status=…&status=…&brandId&before&limit: payouts across brands, newest first. */
export const GET = route({ auth: "admin", permission: "any_admin", query: adminPayoutsQuery }, async ({ actor, query }) => {
  assertAdminFinance(actor)
  const payouts = await listPayouts({ status: query.status, brandId: query.brandId, before: query.before, limit: query.limit })
  return { payouts, nextBefore: payouts.length ? payouts[payouts.length - 1].requestedAt : null }
})
