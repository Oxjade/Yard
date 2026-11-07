import { eq } from "drizzle-orm"
import { reactionBody } from "@/lib/api/contracts/inbox"
import { requireBrandResource } from "@/server/auth/dal"
import { db } from "@/server/db"
import { messages } from "@/server/db/schema"
import { route } from "@/server/http/route"
import { brandCanInteract } from "@/server/inbox/interact"
import { loadBrandConversation, react } from "@/server/inbox/service"

/** POST /api/studio/inbox/messages/{id}/reaction { emoji: '♥' | null } (inbox.reply). */
export const POST = route({ auth: "brand", permission: "inbox.reply", body: reactionBody, maxBody: 512, rate: { key: "studio.inbox.react", limit: 30, windowSec: 60 } }, async ({ params, body }) => {
  const d = await db()
  const [m] = await d.select({ conversationId: messages.conversationId }).from(messages).where(eq(messages.id, params.id)).limit(1)
  const { actor, resource } = await requireBrandResource(async (brandId) => (m ? loadBrandConversation(brandId, m.conversationId) : null), "inbox.reply")
  const gate = await brandCanInteract(actor, resource)
  if (!gate.ok) throw gate.error
  return { message: await react("brand", resource, params.id, body.emoji, actor.userId) }
})
