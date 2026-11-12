import { json, route } from "@/server/http/route"
import { assertAdminFinance } from "@/server/ledger/access"
import { createBatch, listBatches } from "@/server/ledger/payouts"
import { createBatchBody } from "@/server/ledger/schemas"

/** GET /api/admin/finance/batches: recent payout batches. */
export const GET = route({ rate: { key: "finance.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "any_admin" }, async ({ actor }) => {
  assertAdminFinance(actor)
  return { batches: await listBatches() }
})

/** POST /api/admin/finance/batches { currency, payoutIds? }: batches approved payouts of one currency. */
export const POST = route(
  { auth: "admin", permission: "any_admin", body: createBatchBody, rate: { key: "finance.batch", limit: 30, windowSec: 3600 } },
  async ({ actor, body, ipHash }) => json({ batch: await createBatch(actor, body, ipHash) }, 201),
)
