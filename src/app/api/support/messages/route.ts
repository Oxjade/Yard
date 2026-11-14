import { supportSendBody } from "@/lib/api/contracts/support"
import { json, route } from "@/server/http/route"
import { sendAsParty } from "@/server/support/service"

/**
 * POST /api/support/messages: the shopper's message to Yard Support. Creates the thread on the first
 * message. 201 { message, conversation }; a retried clientId returns the original (200).
 */
export const POST = route({ auth: "shopper", body: supportSendBody, maxBody: 16 * 1024 }, async ({ actor, body, ipHash }) => {
  const { status, result } = await sendAsParty(actor, body, ipHash)
  return json(result, status)
})
