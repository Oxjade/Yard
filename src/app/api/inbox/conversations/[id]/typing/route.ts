import { notFound } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { shopperCanInteract } from "@/server/inbox/interact"
import { loadShopperConversation, typing, typingAllowed } from "@/server/inbox/service"

/**
 * POST /api/inbox/conversations/{id}/typing → 204. The limits (60 a minute, 1 per 2 s per
 * conversation) run before any database read; refusals and excess are silent (§4.4).
 */
export const POST = route({ auth: "shopper" }, async ({ actor, params }) => {
  if (!typingAllowed(`shopper:${actor.userId}`, params.id)) return noContent()
  const conv = await loadShopperConversation(actor.userId, params.id)
  if (!conv) throw notFound("We couldn't find that conversation.")
  await typing("customer", conv, await shopperCanInteract(actor, { brandId: conv.brandId, locked: conv.locked }))
  return noContent()
})
