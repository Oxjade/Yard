import { noContent, route } from "@/server/http/route"
import { typingAllowed } from "@/server/inbox/service"
import { loadPartyConversation, partyOfShopper, supportTyping } from "@/server/support/service"

/** POST /api/support/conversation/typing → 204 (always; excess and a missing thread are silent). */
export const POST = route({ auth: "shopper" }, async ({ actor }) => {
  if (!typingAllowed(`shopper:${actor.userId}`, "support")) return noContent()
  const conv = await loadPartyConversation(partyOfShopper(actor))
  if (conv) await supportTyping(conv, "customer")
  return noContent()
})
