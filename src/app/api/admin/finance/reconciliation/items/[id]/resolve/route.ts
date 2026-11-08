import { route } from "@/server/http/route"
import { resolveItem } from "@/server/ledger/reconcile"
import { resolveBody } from "@/server/ledger/schemas"

/** POST /api/admin/finance/reconciliation/items/{id}/resolve { note }: marks a mismatch resolved (audited). */
export const POST = route(
  { auth: "admin", permission: "any_admin", body: resolveBody, rate: { key: "finance.resolve", limit: 120, windowSec: 3600 } },
  async ({ actor, params, body, ipHash }) => ({ item: await resolveItem(actor, params.id, body.note, ipHash) }),
)
