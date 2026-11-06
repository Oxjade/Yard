import { readBody } from "@/lib/api/contracts/inbox"
import { requireBrandResource } from "@/server/auth/dal"
import { noContent, route } from "@/server/http/route"
import { brandCanInteract } from "@/server/inbox/interact"
import { loadBrandConversation, markRead } from "@/server/inbox/service"

/** POST …/read { upToSeq } → 204. Any member who can read the inbox clears the brand's unread state (§4.4). */
export const POST = route({ auth: "brand", permission: "inbox.read", body: readBody, maxBody: 512, rate: { key: "studio.inbox.read", limit: 60, windowSec: 60 } }, async ({ params, body }) => {
  const { actor, resource } = await requireBrandResource((brandId) => loadBrandConversation(brandId, params.id), "inbox.read")
  const gate = await brandCanInteract(actor, resource)
  await markRead("brand", resource, body.upToSeq, gate.ok)
  return noContent()
})
