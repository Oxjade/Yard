import { route } from "@/server/http/route"
import { chargeCurrencies, paymentsMode } from "@/server/payments/config"

/**
 * GET /api/checkout/options (public). How this deployment takes payments, so the checkout shows the
 * right words: `mode` is "off" (no provider yet: checkout is closed, "Payments open soon"), "stub"
 * (nothing is charged), "test" (Paystack test keys) or "live", and
 * `currencies` lists the currencies this Paystack account can charge in (chargeCurrencies: NGN alone
 * with a key unless PAYSTACK_CHARGE_CURRENCIES says more). Never exposes a key.
 */
export const GET = route({ auth: "public", rate: { key: "checkout.options", limit: 120, windowSec: 60, anonGlobal: 3000 } }, async () => ({
  mode: paymentsMode(),
  currencies: chargeCurrencies(),
}))
