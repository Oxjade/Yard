"use client"

import { useMemo } from "react"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import type { QuoteBody, QuoteGroupDto } from "@/lib/api/contracts/shipping"
import { postQuote } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import type { CartLine } from "@/lib/stores/cart"
import { variantById } from "@/lib/data/products"

/** Quotes expire after 30 minutes on the server; refresh well before. */
const REFRESH_MS = 20 * 60_000

/**
 * The server's shipping quote for the bag (§6.5): one group per brand, each with its options,
 * estimates and a signed quote token. `error` is separate from `quotes === null`, so a caller
 * shows "Calculating shipping" only while `isLoading`, and its error state after a failure.
 * The quote is fetched for exactly these lines (no previous bag's quote is kept on screen).
 */
export function useShippingQuote(lines: CartLine[], shipTo: CountryCode, shipToCity: string | null, currency: CurrencyCode, opts: { enabled?: boolean } = {}) {
  const body = useMemo<QuoteBody | null>(() => {
    const byBrand = new Map<string, QuoteBody["groups"][number]>()
    for (const l of lines) {
      const hit = variantById.get(l.variantId)
      if (!hit) continue
      const g = byBrand.get(hit.product.brandId) ?? { brandId: hit.product.brandId, lines: [] }
      g.lines.push({ productId: hit.product.id, variantId: l.variantId, qty: Math.min(20, Math.max(1, l.quantity)) })
      byBrand.set(hit.product.brandId, g)
    }
    if (!byBrand.size) return null
    return { to: shipTo, ...(shipToCity ? { city: shipToCity } : {}), currency, groups: [...byBrand.values()] }
  }, [lines, shipTo, shipToCity, currency])

  const key = opts.enabled === false || !body ? null : `shipping:quote:${JSON.stringify(body)}`
  const q = useApi(key, () => postQuote(body!), { revalidateOnFocus: false, refreshInterval: REFRESH_MS, keepPrevious: false })
  const quotes = useMemo<Record<string, QuoteGroupDto> | null>(() => (q.data ? Object.fromEntries(q.data.groups.map((g) => [g.brandId, g])) : null), [q.data])
  return {
    quotes,
    expiresAt: q.data?.expiresAt ?? null,
    isLoading: q.isLoading,
    /** Only when there's no quote to show: a failed refresh behind a quote on screen isn't an error. */
    error: quotes ? undefined : q.error,
    retry: () => void q.revalidate(),
    retrying: q.isValidating,
  }
}
