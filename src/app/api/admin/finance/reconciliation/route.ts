import { json, route } from "@/server/http/route"
import { writeAudit } from "@/server/audit"
import { assertAdminFinance } from "@/server/ledger/access"
import { listRuns, runReconciliation } from "@/server/ledger/reconcile"

/** GET /api/admin/finance/reconciliation: recent reconciliation runs. */
export const GET = route({ auth: "admin", permission: "any_admin" }, async ({ actor }) => {
  assertAdminFinance(actor)
  return { runs: await listRuns() }
})

/** POST /api/admin/finance/reconciliation: runs a reconciliation now. */
export const POST = route({ auth: "admin", permission: "any_admin", rate: { key: "finance.reconcile", limit: 6, windowSec: 3600 } }, async ({ actor, ipHash }) => {
  assertAdminFinance(actor)
  const result = await runReconciliation({ triggeredBy: actor.userId })
  await writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "finance.reconciliation_run", subjectType: "reconciliation_run", subjectId: result.runId, ipHash, meta: { mismatches: result.mismatches, providerCompared: result.providerCompared } })
  return json(result, 201)
})
