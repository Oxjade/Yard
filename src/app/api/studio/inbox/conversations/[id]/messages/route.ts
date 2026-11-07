import { threadQuery } from "@/lib/api/contracts/inbox"
import { requireBrandResource } from "@/server/auth/dal"
import { route } from "@/server/http/route"
import { brandInteraction, loadBrandConversation, thread } from "@/server/inbox/service"

/** GET /api/studio/inbox/conversations/{id}/messages: the thread as the brand sees it (never the shopper's held messages). */
export const GET = route({ auth: "brand", permission: "inbox.read", query: threadQuery, rate: { key: "studio.inbox.thread", limit: 180, windowSec: 60 } }, async ({ params, query }) => {
  const { actor, resource } = await requireBrandResource((brandId) => loadBrandConversation(brandId, params.id), "inbox.read")
  return thread("brand", resource, await brandInteraction(actor, resource), query)
})
