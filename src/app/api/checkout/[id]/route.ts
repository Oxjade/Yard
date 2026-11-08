import { isSafeId } from "@/lib/api/contracts/common"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { getCheckout } from "@/server/payments/checkout"

/** GET /api/checkout/{id} (shopper, owner only, else 404): status, totals, order ids and the payment state. */
export const GET = route({ auth: "shopper", rate: { key: "checkout.read", limit: 120, windowSec: 60 } }, async ({ actor, params }) => {
  if (!isSafeId(params.id)) throw notFound()
  return getCheckout(actor, params.id)
})
