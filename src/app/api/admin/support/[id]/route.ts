import { adminSupportPatchBody } from "@/lib/api/contracts/support"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { caseFor, loadSupportConversation, patchSupport } from "@/server/support/service"

/** GET /api/admin/support/{id} → { case: SupportCaseDto }. */
export const GET = route({ auth: "admin", permission: "support.manage", rate: { key: "admin.support", limit: 240, windowSec: 60 } }, async ({ params }) => {
  const c = await caseFor(params.id)
  if (!c) throw notFound("We couldn't find that conversation.")
  return { case: c }
})

/** PATCH /api/admin/support/{id} { status?: "open" | "resolved", assignee?: "me" | null } → { case }. */
export const PATCH = route({ auth: "admin", permission: "support.manage", body: adminSupportPatchBody, maxBody: 1024, rate: { key: "admin.support.patch", limit: 60, windowSec: 60 } }, async ({ actor, params, body, ipHash }) => {
  const conv = await loadSupportConversation(params.id)
  if (!conv || conv.lastMessageSeq <= 0) throw notFound("We couldn't find that conversation.")
  return { case: await patchSupport(actor, conv, body, ipHash) }
})
