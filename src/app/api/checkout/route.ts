import { mergeAnonCart } from "@/server/cart"
import { json, route } from "@/server/http/route"
import { startCheckout, startCheckoutBody } from "@/server/payments/checkout"

/**
 * POST /api/checkout (shopper). Starts a checkout for the shopper's server cart: re-priced from
 * CATALOG, delivery quoted per brand, stock held, orders created (pending payment) and a Paystack
 * transaction initialised. Idempotent per (shopper, idempotencyKey): a retry returns the same
 * checkout (200) and re-tries the provider when it wasn't reached. 409 with field errors when
 * stock, prices (expectedTotalMinor) or delivery changed. The response's `payment` carries the
 * Paystack authorizationUrl / accessCode, or `stub: true` with a message when payments aren't
 * connected (nothing is charged).
 */
export const POST = route(
  { auth: "shopper", body: startCheckoutBody, maxBody: 8 * 1024, rate: { key: "checkout.start", limit: 10, windowSec: 60, daily: 100 } },
  async ({ actor, body }) => {
    await mergeAnonCart(actor.userId)
    const r = await startCheckout(actor, body)
    return json(r.view, r.status)
  },
)
