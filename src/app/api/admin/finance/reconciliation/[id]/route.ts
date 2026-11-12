import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { getRun } from "@/server/ledger/reconcile"

/** GET /api/admin/finance/reconciliation/{id}: the run and its mismatch items. */
export const GET = route({ rate: { key: "finance.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "any_admin" }, async ({ actor, params }) => {
  assertAdminFinance(actor)
  return getRun(params.id)
})
