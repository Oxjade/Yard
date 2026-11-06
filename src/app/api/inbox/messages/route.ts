import { sendMessageBody } from "@/lib/api/contracts/inbox"
import { json, route } from "@/server/http/route"
import { sendAsShopper } from "@/server/inbox/service"

/**
 * POST /api/inbox/messages (§6.2): a shopper's message. Creates the conversation when needed.
 * 201 { message, conversation }; retrying the same clientId returns the original (200).
 * Limits (20/min, 300/day, and 5/hour, 20/day for new conversations) are applied after the
 * idempotency check, so a retry never spends the budget.
 */
export const POST = route({ auth: "shopper", body: sendMessageBody, maxBody: 16 * 1024 }, async ({ actor, body, ipHash }) => {
  const { status, result } = await sendAsShopper(actor, body, ipHash)
  return json(result, status)
})
