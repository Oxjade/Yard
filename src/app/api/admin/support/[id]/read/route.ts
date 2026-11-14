import { readBody } from "@/lib/api/contracts/inbox"
import { notFound } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { loadSupportConversation, markSupportRead } from "@/server/support/service"

/** POST /api/admin/support/{id}/read { upToSeq } → 204: Yard Support read the party's messages (shared by every admin). */
export const POST = route({ auth: "admin", permission: "support.manage", body: readBody, maxBody: 512, rate: { key: "admin.support.read", limit: 120, windowSec: 60 } }, async ({ actor, params, body }) => {
  const conv = await loadSupportConversation(params.id)
  if (!conv) throw notFound("We couldn't find that conversation.")
  await markSupportRead(conv, "support", body.upToSeq, actor)
  return noContent()
})
