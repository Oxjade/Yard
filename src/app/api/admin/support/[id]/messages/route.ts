import { threadQuery } from "@/lib/api/contracts/inbox"
import { adminSupportSendBody } from "@/lib/api/contracts/support"
import { notFound } from "@/server/http/errors"
import { json, route } from "@/server/http/route"
import { loadSupportConversation, sendAsSupport, supportThread } from "@/server/support/service"

/** GET /api/admin/support/{id}/messages?before=&after=&limit= → ThreadDto as Yard Support sees it (each "support" message names its admin in `author`). */
export const GET = route({ auth: "admin", permission: "support.manage", query: threadQuery, rate: { key: "admin.support.thread", limit: 240, windowSec: 60 } }, async ({ params, query }) => {
  const conv = await loadSupportConversation(params.id)
  if (!conv || conv.lastMessageSeq <= 0) throw notFound("We couldn't find that conversation.")
  return supportThread(conv, "support", query)
})

/** POST /api/admin/support/{id}/messages { clientId, body } → 201 { message, conversation } as Yard Support (200 for a retried clientId). */
export const POST = route({ auth: "admin", permission: "support.manage", body: adminSupportSendBody, maxBody: 16 * 1024 }, async ({ actor, params, body, ipHash }) => {
  const conv = await loadSupportConversation(params.id)
  if (!conv || conv.lastMessageSeq <= 0) throw notFound("We couldn't find that conversation.")
  const { status, result } = await sendAsSupport(actor, conv, body, ipHash)
  return json(result, status)
})
