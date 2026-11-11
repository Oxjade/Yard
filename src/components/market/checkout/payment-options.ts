"use client"

import type { CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import type { CheckoutOptions } from "@/lib/api/contracts/checkout"
import { useApi } from "@/lib/api/use-api"

/**
 * How this deployment takes payments (GET /api/checkout/options): "stub", "test" or "live".
 * While it loads, and if it fails, this is null, which callers treat like live: test-mode words
 * must never show on a live checkout.
 */
export function usePaymentsMode(): CheckoutOptions["mode"] | null {
  return useCheckoutOptions().mode
}

const useOptions = () => useApi<CheckoutOptions>("checkout.options", () => api<CheckoutOptions>("/api/checkout/options"), { revalidateOnFocus: false })

/** NGN is what every Paystack account can charge in: the safe answer until the server says more. */
const SAFE_CURRENCIES: readonly CurrencyCode[] = ["NGN"]

/**
 * The deployment's payment mode and the currencies its Paystack account can charge in. Until the
 * options load (or if they fail) the mode is null and the currencies are NGN alone, the live-safe
 * answer; the server refuses any other currency anyway. `ready` is true once the request has settled
 * (loaded or failed).
 */
export function useCheckoutOptions(): { mode: CheckoutOptions["mode"] | null; currencies: readonly CurrencyCode[]; ready: boolean } {
  const q = useOptions()
  const data = q.error ? undefined : q.data
  const currencies = data?.currencies?.length ? (data.currencies as CurrencyCode[]) : SAFE_CURRENCIES
  return { mode: data?.mode ?? null, currencies, ready: !!data || !!q.error }
}
