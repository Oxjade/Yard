/**
 * A brand's delivery options for one product, from the brand's own shipping zones, methods and
 * tiered rates (shipping_zones / shipping_methods / shipping_rates), as structured data and the
 * product feed state them. Pure: the server passes the rows (src/server/seo/catalog.ts).
 *
 * Only facts the brand set: a zone must name its countries (the catch-all international zone, "*",
 * names none, so it is left out), a method must have a rate in the product's currency, and the rate
 * is the tier that applies to the product's price (the highest min_subtotal at or below it, as
 * checkout prices a one-item order). Per zone, the cheapest such shipped method (never store pickup).
 */
import type { SeoShippingOption } from "./json-ld"

export type ShippingRateRow = { minSubtotalMinor: number; amountMinor: number; currency: string }
export type ShippingMethodRow = { service: string; enabled: boolean; transitMin: number; transitMax: number; rates: ShippingRateRow[] }
export type ShippingZoneRow = { enabled: boolean; countries: string[]; methods: ShippingMethodRow[] }

const MAX_COUNTRIES = 25

export function rateFor(rates: ShippingRateRow[], subtotalMinor: number, currency: string): number | null {
  let best: ShippingRateRow | null = null
  for (const r of rates) {
    if (r.currency !== currency || r.minSubtotalMinor > subtotalMinor) continue
    if (!best || r.minSubtotalMinor > best.minSubtotalMinor) best = r
  }
  return best ? best.amountMinor : null
}

export function shippingOptions(zones: ShippingZoneRow[], priceMinor: number, currency: string, handling: [number, number]): SeoShippingOption[] {
  const out: SeoShippingOption[] = []
  for (const z of zones) {
    if (!z.enabled) continue
    const countries = [...new Set(z.countries.filter((c) => /^[A-Z]{2}$/.test(c)))].slice(0, MAX_COUNTRIES)
    if (!countries.length) continue
    let pick: SeoShippingOption | null = null
    for (const m of z.methods) {
      // Picking up in store isn't delivery: only shipped methods count.
      if (!m.enabled || m.service === "pickup") continue
      const rate = rateFor(m.rates, priceMinor, currency)
      if (rate === null) continue
      if (!pick || rate < pick.rateMinor || (rate === pick.rateMinor && m.transitMax < pick.transit[1])) {
        pick = { countries, rateMinor: rate, currency, handling, transit: [m.transitMin, Math.max(m.transitMin, m.transitMax)] }
      }
    }
    if (pick) out.push(pick)
  }
  return out
}
