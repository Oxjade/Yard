import { requireBrandResource } from "@/server/auth/dal"
import { noContent, route } from "@/server/http/route"
import { brandCanInteract } from "@/server/inbox/interact"
import { loadBrandConversation, typing, typingAllowed } from "@/server/inbox/service"

/**
 * POST …/typing → 204. The limits (60 a minute per member, 1 per 2 s per conversation) run
 * before the conversation is loaded; refusals and excess are silent (§4.4).
 */
export const POST = route({ auth: "brand", permission: "inbox.reply" }, async ({ actor, params }) => {
  if (!typingAllowed(`member:${actor.userId}`, params.id)) return noContent()
  const { actor: member, resource } = await requireBrandResource((brandId) => loadBrandConversation(brandId, params.id), "inbox.reply")
  await typing("brand", resource, await brandCanInteract(member, resource))
  return noContent()
})
