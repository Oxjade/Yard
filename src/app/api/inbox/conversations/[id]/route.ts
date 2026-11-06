import { shopperPatchBody } from "@/lib/api/contracts/inbox"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { loadShopperConversation, patchShopper, shopperInteraction } from "@/server/inbox/service"
import { summaryFor } from "@/server/inbox/dto"

/** GET /api/inbox/conversations/{id}: one of the shopper's conversations, with its composer state. */
export const GET = route({ auth: "shopper", rate: { key: "inbox.list", limit: 120, windowSec: 60 } }, async ({ actor, params }) => {
  const conv = await loadShopperConversation(actor.userId, params.id)
  if (!conv) throw notFound("We couldn't find that conversation.")
  const summary = await summaryFor(conv.id, "customer")
  return { conversation: { ...summary!, interaction: await shopperInteraction(actor, conv) } }
})

/** PATCH /api/inbox/conversations/{id} { archived?, muted? }: the shopper's own view of the thread. */
export const PATCH = route({ auth: "shopper", body: shopperPatchBody, maxBody: 1024, rate: { key: "inbox.patch", limit: 60, windowSec: 60 } }, async ({ actor, params, body }) => {
  const conv = await loadShopperConversation(actor.userId, params.id)
  if (!conv) throw notFound("We couldn't find that conversation.")
  return { conversation: await patchShopper(conv, body) }
})
