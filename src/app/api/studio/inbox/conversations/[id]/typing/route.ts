import { requireBrandResource } from "@/server/auth/dal"
import { noContent, route } from "@/server/http/route"
import { brandCanInteract } from "@/server/inbox/interact"
import { loadBrandConversation, typing } from "@/server/inbox/service"

/** POST …/typing → 204, silent when refused or repeated within 2 s (§4.4). */
export const POST = route({ auth: "brand", permission: "inbox.reply" }, async ({ params }) => {
  const { actor, resource } = await requireBrandResource((brandId) => loadBrandConversation(brandId, params.id), "inbox.reply")
  await typing("brand", resource, `member:${actor.userId}`, await brandCanInteract(actor, resource))
  return noContent()
})
