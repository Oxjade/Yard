import "server-only"
import { countries, type CurrencyCode } from "@/config/markets"
import type { QuoteOption, QuoteRequest, ShippingProvider, ZoneWithMethods } from "./types"

const SERVICES = ["standard", "express", "pickup"] as const

/**
 * The zone that covers a destination: the first zone (by position) that lists the country, else
 * the international zone ('*' = everything no other zone covers). A zone that lists the country
 * but is switched off still covers it, so turning Domestic off never falls through to
 * International.
 */
export function zoneFor(zones: ZoneWithMethods[], country: string) {
  const sorted = [...zones].sort((a, b) => a.position - b.position)
  return sorted.find((z) => z.countries.includes(country)) ?? sorted.find((z) => z.countries.includes("*")) ?? null
}

/** The tier that applies: the highest minimum at or below the subtotal. */
export function tierFor(rates: { minSubtotalMinor: number; amountMinor: number }[], subtotal: number) {
  return [...rates].sort((a, b) => b.minSubtotalMinor - a.minSubtotalMinor).find((r) => r.minSubtotalMinor <= subtotal) ?? null
}

/** "Free over X": the lowest minimum whose tier costs nothing, when there is one above 0. */
export function freeThreshold(rates: { minSubtotalMinor: number; amountMinor: number }[]) {
  const free = rates.filter((r) => r.amountMinor === 0 && r.minSubtotalMinor > 0).sort((a, b) => a.minSubtotalMinor - b.minSubtotalMinor)
  return free[0]?.minSubtotalMinor ?? null
}

/**
 * Manual rates: the brand's own zones, methods and price tiers (§6.5). Never guaranteed; no
 * tracking or labels (merchants enter tracking by hand in Studio).
 */
export const manualProvider: ShippingProvider = {
  id: "manual",
  label: "Manual rates",
  kind: "manual",
  capabilities: { rates: true, estimates: true, tracking: false, labels: false, guaranteedDates: false },
  isConfigured: () => true,
  async quote(req: QuoteRequest): Promise<QuoteOption[]> {
    const cur = req.profile.currency as CurrencyCode
    const where = countries[req.destination.country]?.name ?? req.destination.country
    const zone = zoneFor(req.zones, req.destination.country)
    const none = (reason: string): QuoteOption[] => [
      { methodId: "none", service: "standard", label: "Standard", available: false, reason, price: { amount: 0, currency: cur }, free: false, transit: [0, 0], providerId: "manual", guaranteed: false },
    ]
    if (!zone || !zone.enabled) return none(`Doesn't ship to ${where}`)

    const out: QuoteOption[] = []
    for (const service of SERVICES) {
      const m = zone.methods.find((x) => x.service === service)
      // A method that is missing or switched off isn't offered at all.
      if (!m || !m.enabled) continue
      if (service === "pickup") {
        // Pickup only where the shopper's city is the pickup point's city.
        const p = req.pickup
        if (!req.profile.localPickup || !p || !req.destination.citySlug || req.destination.citySlug !== p.citySlug) continue
      }
      const tier = tierFor(m.rates, req.subtotal.amount)
      if (!tier) continue
      const threshold = freeThreshold(m.rates)
      out.push({
        methodId: m.id,
        service,
        label: service === "pickup" && req.pickup ? `Pick up in ${req.pickup.area}` : m.label,
        available: true,
        price: { amount: tier.amountMinor, currency: cur },
        free: tier.amountMinor === 0,
        freeOver: threshold !== null ? { amount: threshold, currency: cur } : undefined,
        transit: service === "pickup" ? [0, 0] : [m.transitMin, Math.max(m.transitMin, m.transitMax)],
        providerId: "manual",
        guaranteed: false,
        pickup: service === "pickup" && req.pickup ? { name: req.pickup.name, area: req.pickup.area } : undefined,
      })
    }
    if (!out.some((o) => o.service !== "pickup")) {
      // Only pickup (or nothing) is on for this zone: the parcel options aren't available.
      return out.length ? out : none(`Doesn't ship to ${where}`)
    }
    return out
  },
}
