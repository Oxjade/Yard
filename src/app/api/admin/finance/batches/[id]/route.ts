import { route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { getBatch } from "@/server/ledger/payouts"

/** GET /api/admin/finance/batches/{id}: the batch and its payouts. */
export const GET = route({ rate: { key: "finance.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "any_admin" }, async ({ actor, params }) => {
  assertAdminFinance(actor)
  return getBatch(params.id)
})
