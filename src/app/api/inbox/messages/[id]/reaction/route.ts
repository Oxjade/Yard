import { reactionBody } from "@/lib/api/contracts/inbox"
import { db } from "@/server/db"
import { messages } from "@/server/db/schema"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { shopperCanInteract } from "@/server/inbox/interact"
import { loadShopperConversation, react } from "@/server/inbox/service"
import { eq } from "drizzle-orm"

/** POST /api/inbox/messages/{id}/reaction { emoji: '♥' | null }: blocked or restricted → 403 (§4.4). */
export const POST = route({ auth: "shopper", body: reactionBody, maxBody: 512, rate: { key: "inbox.react", limit: 30, windowSec: 60 } }, async ({ actor, params, body }) => {
  const d = await db()
  const [m] = await d.select({ conversationId: messages.conversationId }).from(messages).where(eq(messages.id, params.id)).limit(1)
  const conv = m ? await loadShopperConversation(actor.userId, m.conversationId) : null
  if (!conv) throw notFound("We couldn't find that message.")
  const gate = await shopperCanInteract(actor, { brandId: conv.brandId, locked: conv.locked })
  if (!gate.ok) throw gate.error
  return { message: await react("customer", conv, params.id, body.emoji, actor.userId) }
})
