import { studioSendMessageBody } from "@/lib/api/contracts/inbox"
import { requireBrandResource } from "@/server/auth/dal"
import { json, route } from "@/server/http/route"
import { loadBrandConversation, sendAsBrand } from "@/server/inbox/service"

/**
 * POST /api/studio/inbox/messages (inbox.reply): a reply in a conversation the shopper started.
 * There is no way to start one: without a conversationId the body is 400 (§5.2).
 */
export const POST = route({ auth: "brand", permission: "inbox.reply", body: studioSendMessageBody, maxBody: 16 * 1024 }, async ({ body, ipHash }) => {
  const { actor, resource } = await requireBrandResource((brandId) => loadBrandConversation(brandId, body.conversationId), "inbox.reply")
  const { status, result } = await sendAsBrand(actor, resource, body, ipHash)
  return json(result, status)
})
