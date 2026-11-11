import { route } from "@/server/http/route"
import { PAYSTACK_CURRENCIES, paymentsMode } from "@/server/payments/config"

/**
 * GET /api/checkout/options (public). How this deployment takes payments, so the checkout shows the
 * right words: `mode` is "stub" (nothing is charged), "test" (Paystack test keys) or "live", and
 * `currencies` lists the currencies a checkout can charge in. Never exposes a key.
 */
export const GET = route({ auth: "public", rate: { key: "checkout.options", limit: 120, windowSec: 60, anonGlobal: 3000 } }, async () => ({
  mode: paymentsMode(),
  currencies: [...PAYSTACK_CURRENCIES],
}))
