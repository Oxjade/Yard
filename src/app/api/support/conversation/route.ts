import { route } from "@/server/http/route"
import { loadPartyConversation, partyOfShopper, partySummary } from "@/server/support/service"

/** GET /api/support/conversation → { conversation: ConversationSummary | null }: the caller's Yard Support thread (null before the first message). */
export const GET = route({ auth: "shopper", rate: { key: "support.thread", limit: 180, windowSec: 60 } }, async ({ actor }) => {
  const conv = await loadPartyConversation(partyOfShopper(actor))
  return { conversation: conv ? await partySummary(conv) : null }
})
