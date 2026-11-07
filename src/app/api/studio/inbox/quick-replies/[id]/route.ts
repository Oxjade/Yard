import { quickReplyPatchBody } from "@/lib/api/contracts/inbox"
import { requireBrandResource } from "@/server/auth/dal"
import { noContent, route } from "@/server/http/route"
import { deleteQuickReply, loadQuickReply, updateQuickReply } from "@/server/inbox/service"

/** PATCH /api/studio/inbox/quick-replies/{id} (inbox.manage). Another brand's reply is 404. */
export const PATCH = route({ auth: "brand", permission: "inbox.manage", body: quickReplyPatchBody, maxBody: 4096, rate: { key: "studio.qr.write", limit: 60, windowSec: 60 } }, async ({ params, body }) => {
  const { actor } = await requireBrandResource((brandId) => loadQuickReply(brandId, params.id), "inbox.manage")
  return { item: await updateQuickReply(actor, params.id, body) }
})

/** DELETE (inbox.manage). */
export const DELETE = route({ auth: "brand", permission: "inbox.manage", rate: { key: "studio.qr.write", limit: 60, windowSec: 60 } }, async ({ params }) => {
  const { actor } = await requireBrandResource((brandId) => loadQuickReply(brandId, params.id), "inbox.manage")
  await deleteQuickReply(actor, params.id)
  return noContent()
})
