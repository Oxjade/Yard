import { threadQuery } from "@/lib/api/contracts/inbox"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { loadShopperConversation, shopperInteraction, thread } from "@/server/inbox/service"

/** GET /api/inbox/conversations/{id}/messages?before=&after=&limit=&q= : the thread as the shopper sees it. */
export const GET = route({ auth: "shopper", query: threadQuery, rate: { key: "inbox.thread", limit: 180, windowSec: 60 } }, async ({ actor, params, query }) => {
  const conv = await loadShopperConversation(actor.userId, params.id)
  if (!conv) throw notFound("We couldn't find that conversation.")
  return thread("customer", conv, await shopperInteraction(actor, conv), query)
})
