"use client"

import { api } from "@/lib/api/client"
import type { CheckoutOptions } from "@/lib/api/contracts/checkout"
import { useApi } from "@/lib/api/use-api"

/**
 * How this deployment takes payments (GET /api/checkout/options): "stub", "test" or "live".
 * While it loads, and if it fails, this is null, which callers treat like live: test-mode words
 * must never show on a live checkout.
 */
export function usePaymentsMode(): CheckoutOptions["mode"] | null {
  const q = useApi<CheckoutOptions>("checkout.options", () => api<CheckoutOptions>("/api/checkout/options"), { revalidateOnFocus: false })
  return q.error ? null : (q.data?.mode ?? null)
}
