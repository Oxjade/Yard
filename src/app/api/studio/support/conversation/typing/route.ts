import { noContent, route } from "@/server/http/route"
import { typingAllowed } from "@/server/inbox/service"
import { loadPartyConversation, partyOfBrand, supportTyping } from "@/server/support/service"

/** POST /api/studio/support/conversation/typing → 204 (always; excess and a missing thread are silent). */
export const POST = route({ auth: "brand", permission: "any_member" }, async ({ actor }) => {
  if (!typingAllowed(`member:${actor.userId}`, "support")) return noContent()
  const conv = await loadPartyConversation(partyOfBrand(actor))
  if (conv) await supportTyping(conv, "brand")
  return noContent()
})
