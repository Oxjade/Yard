import { noContent, route } from "@/server/http/route"
import { typingAllowed } from "@/server/inbox/service"
import { loadSupportConversation, supportTyping } from "@/server/support/service"

/** POST /api/admin/support/{id}/typing → 204: "Yard Support is typing" for the party. */
export const POST = route({ auth: "admin", permission: "support.manage" }, async ({ actor, params }) => {
  if (!typingAllowed(`admin:${actor.userId}`, params.id)) return noContent()
  const conv = await loadSupportConversation(params.id)
  if (conv) await supportTyping(conv, "support")
  return noContent()
})
