import { notFound } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { shopperCanInteract } from "@/server/inbox/interact"
import { loadShopperConversation, typing } from "@/server/inbox/service"

/** POST /api/inbox/conversations/{id}/typing → 204. Refusals and repeats inside 2 s are silent (§4.4). */
export const POST = route({ auth: "shopper" }, async ({ actor, params }) => {
  const conv = await loadShopperConversation(actor.userId, params.id)
  if (!conv) throw notFound("We couldn't find that conversation.")
  await typing("customer", conv, `shopper:${actor.userId}`, await shopperCanInteract(actor, { brandId: conv.brandId, locked: conv.locked }))
  return noContent()
})
