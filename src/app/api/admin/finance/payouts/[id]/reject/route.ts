import { route } from "@/server/http/route"
import { rejectPayout } from "@/server/ledger/payouts"
import { rejectBody } from "@/server/ledger/schemas"

/** POST /api/admin/finance/payouts/{id}/reject { reason }: rejects an unbatched payout; the funds return to available. */
export const POST = route(
  { auth: "admin", permission: "any_admin", body: rejectBody, rate: { key: "finance.reject", limit: 60, windowSec: 3600 } },
  async ({ actor, params, body, ipHash }) => ({ payout: await rejectPayout(actor, params.id, body.reason, ipHash) }),
)
