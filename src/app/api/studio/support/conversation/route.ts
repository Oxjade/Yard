import { route } from "@/server/http/route"
import { loadPartyConversation, partyOfBrand, partySummary } from "@/server/support/service"

/** GET /api/studio/support/conversation → { conversation: ConversationSummary | null }: the caller's Yard Support thread (null before the first message). */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "support.thread", limit: 180, windowSec: 60 } }, async ({ actor }) => {
  const conv = await loadPartyConversation(partyOfBrand(actor))
  return { conversation: conv ? await partySummary(conv) : null }
})
