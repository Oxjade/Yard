import { route } from "@/server/http/route"
import { approvePayout } from "@/server/ledger/payouts"
import { approveBody } from "@/server/ledger/schemas"

/**
 * POST /api/admin/finance/payouts/{id}/approve { note? }: first or second approval. Finance role,
 * recent re-auth; the second approver must be a different admin; nobody approves their own brand.
 */
export const POST = route(
  { auth: "admin", permission: "any_admin", body: approveBody, rate: { key: "finance.approve", limit: 60, windowSec: 3600 } },
  async ({ actor, params, body, ipHash }) => ({ payout: await approvePayout(actor, params.id, body.note ?? null, ipHash) }),
)
