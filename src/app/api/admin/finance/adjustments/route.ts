import { json, route } from "@/server/http/route"
import { postAdjustment } from "@/server/ledger/payouts"
import { adjustmentBody } from "@/server/ledger/schemas"

/** POST /api/admin/finance/adjustments: a manual credit/debit between a brand account and platform adjustments (re-auth, audited, idempotent). */
export const POST = route(
  { auth: "admin", permission: "any_admin", body: adjustmentBody, rate: { key: "finance.adjust", limit: 30, windowSec: 3600 } },
  async ({ actor, body, ipHash }) => {
    const r = await postAdjustment(actor, body, ipHash)
    return json(r, r.duplicate ? 200 : 201)
  },
)
