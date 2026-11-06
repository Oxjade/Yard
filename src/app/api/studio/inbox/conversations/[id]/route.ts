import { studioPatchBody } from "@/lib/api/contracts/inbox"
import { requireBrandResource } from "@/server/auth/dal"
import { route } from "@/server/http/route"
import { customerContext, loadBrandConversation, patchStudio } from "@/server/inbox/service"

/**
 * GET /api/studio/inbox/conversations/{id}: the summary plus the customer's history with this
 * brand only (orders from order_refs, products discussed). Another brand's conversation is 404.
 */
export const GET = route({ auth: "brand", permission: "inbox.read", rate: { key: "studio.inbox.thread", limit: 180, windowSec: 60 } }, async ({ params }) => {
  const { actor, resource } = await requireBrandResource((brandId) => loadBrandConversation(brandId, params.id), "inbox.read")
  return customerContext(actor, resource)
})

/** PATCH { status?, markedUnread?, spam? } (inbox.manage). */
export const PATCH = route({ auth: "brand", permission: "inbox.manage", body: studioPatchBody, maxBody: 1024, rate: { key: "studio.inbox.patch", limit: 60, windowSec: 60 } }, async ({ params, body, ipHash }) => {
  const { actor, resource } = await requireBrandResource((brandId) => loadBrandConversation(brandId, params.id), "inbox.manage")
  return patchStudio(actor, resource, body, ipHash)
})
