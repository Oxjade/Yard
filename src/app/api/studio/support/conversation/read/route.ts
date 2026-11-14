import { readBody } from "@/lib/api/contracts/inbox"
import { notFound } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { loadPartyConversation, markSupportRead, partyOfBrand } from "@/server/support/service"

/** POST /api/studio/support/conversation/read { upToSeq } → 204: the brand member read Yard Support's messages up to upToSeq. */
export const POST = route({ auth: "brand", permission: "any_member", body: readBody, maxBody: 512, rate: { key: "support.read", limit: 60, windowSec: 60 } }, async ({ actor, body }) => {
  const conv = await loadPartyConversation(partyOfBrand(actor))
  if (!conv) throw notFound("You haven't messaged Yard Support yet.")
  await markSupportRead(conv, "brand", body.upToSeq)
  return noContent()
})
