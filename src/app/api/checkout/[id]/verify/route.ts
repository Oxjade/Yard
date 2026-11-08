import { isSafeId } from "@/lib/api/contracts/common"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { verifyCheckout } from "@/server/payments/checkout"

/**
 * POST /api/checkout/{id}/verify (shopper, owner only). Call on return from Paystack (the
 * callback page /checkout/confirm?checkout={id}) and to poll: asks Paystack for the transaction
 * and applies a final answer exactly as the webhook would. A pending answer changes nothing.
 */
export const POST = route({ auth: "shopper", rate: { key: "checkout.verify", limit: 30, windowSec: 60 } }, async ({ actor, params }) => {
  if (!isSafeId(params.id)) throw notFound()
  return verifyCheckout(actor, params.id)
})
