import { readBody } from "@/lib/api/contracts/inbox"
import { notFound } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { shopperCanInteract } from "@/server/inbox/interact"
import { loadShopperConversation, markRead } from "@/server/inbox/service"

/** POST /api/inbox/conversations/{id}/read { upToSeq } → 204. The reader's counters always update; the receipt only when allowed (§4.4). */
export const POST = route({ auth: "shopper", body: readBody, maxBody: 512, rate: { key: "inbox.read", limit: 60, windowSec: 60 } }, async ({ actor, params, body }) => {
  const conv = await loadShopperConversation(actor.userId, params.id)
  if (!conv) throw notFound("We couldn't find that conversation.")
  const gate = await shopperCanInteract(actor, { brandId: conv.brandId, locked: conv.locked })
  await markRead("customer", conv, body.upToSeq, gate.ok)
  return noContent()
})
