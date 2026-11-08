import { route } from "@/server/http/route"
import { runBatch } from "@/server/ledger/payouts"

/**
 * POST /api/admin/finance/batches/{id}/run: sends the batch's approved payouts through PAYMENTS
 * initiatePayout (recent re-auth). Safe to run again: only payouts still 'approved' are sent, and
 * the payout id is the provider reference.
 */
export const POST = route({ auth: "admin", permission: "any_admin", rate: { key: "finance.batch_run", limit: 10, windowSec: 3600 } }, async ({ actor, params, ipHash }) => runBatch(actor, params.id, ipHash))
