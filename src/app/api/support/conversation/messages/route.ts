import { threadQuery } from "@/lib/api/contracts/inbox"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { loadPartyConversation, partyOfShopper, supportThread } from "@/server/support/service"

/** GET /api/support/conversation/messages?before=&after=&limit= → ThreadDto: the shopper's Yard Support thread. 404 before the first message. */
export const GET = route({ auth: "shopper", query: threadQuery, rate: { key: "support.thread", limit: 180, windowSec: 60 } }, async ({ actor, query }) => {
  const conv = await loadPartyConversation(partyOfShopper(actor))
  if (!conv) throw notFound("You haven't messaged Yard Support yet.")
  return supportThread(conv, "customer", query)
})
