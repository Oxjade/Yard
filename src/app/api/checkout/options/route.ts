import { route } from "@/server/http/route"
import { chargeCurrencies, paymentsConfig, paymentsMode } from "@/server/payments/config"

/**
 * GET /api/checkout/options (public). How this deployment takes payments, so the checkout shows the
 * right words and methods: `mode` is "off" (no provider yet: checkout is closed, "Payments open
 * soon"), "stub" (nothing is charged), "test" (Paystack test / Bachs sandbox keys) or "live";
 * `provider` is "paystack", "bachs", "stub" or "off" (which hosted page the shopper pays on, so the
 * checkout offers that provider's methods for the charge currency); `currencies` lists the
 * currencies the provider account can charge in (chargeCurrencies: NGN alone with a key unless
 * PAYSTACK_CHARGE_CURRENCIES / BACHS_CHARGE_CURRENCIES say more). Never exposes a key.
 */
export const GET = route({ auth: "public", rate: { key: "checkout.options", limit: 120, windowSec: 60, anonGlobal: 3000 } }, async () => ({
  mode: paymentsMode(),
  provider: paymentsConfig().provider,
  currencies: chargeCurrencies(),
}))
