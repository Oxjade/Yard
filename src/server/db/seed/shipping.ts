import "server-only"
import { inArray } from "drizzle-orm"
import { holidayRows } from "@/config/holidays"
import { countries, countryCodes, currencies, freeShippingThresholdUsd, shippingRatesUsd, type CurrencyCode, type ShippingZone } from "@/config/markets"
import { countryTimeZone } from "@/lib/data/zones"
import { convert } from "@/lib/money"
import { defaultExpressTransit } from "@/lib/shipping/estimate"
import { holidays, shippingClosures, shippingMethods, shippingProfiles, shippingRates, shippingZones } from "../schema"
import { db } from "../tx"
import type { SeedModule } from "./types"

/** Round a minor amount to 2 significant figures of its major value (₦9,120 → ₦9,100; ₦304,000 → ₦300,000). */
export function round2(minor: number, cur: CurrencyCode) {
  const m = currencies[cur].minor
  const major = minor / 10 ** m
  if (major <= 0) return 0
  const step = 10 ** (Math.floor(Math.log10(major)) - 1)
  return Math.round(Math.round(major / step) * step * 10 ** m)
}

const PICKUP_LOCATION = "loc_seed_ls_yaba"
const short = (brandId: string) => brandId.replace(/^b_/, "")

/**
 * Shipping (cluster D, Appendix D): the holiday calendar (Appendix B) and a profile for every
 * brand from the static catalogue: origin from shipsFrom and city, handling from processingDays,
 * cutoff 14:00, Mon–Fri, manual rates. Zones are Domestic, Regional (same-region markets, when
 * there are any) and International (everything else); standard and express on each, priced from
 * the platform's demo rates in the brand's currency, with standard free over $200. Lagos Static
 * also offers pickup at its Yaba store, linked only when that place exists (around may seed it
 * later and set the link itself, §1.5). Re-running resets every brand's shipping to these values.
 */
const seed: SeedModule = {
  key: "seed:shipping",
  version: 1,
  async run(ctx) {
    const d = await db()
    await d.insert(holidays).values(holidayRows()).onConflictDoNothing()

    const brandList = [...ctx.brandById.values()]
    const ids = brandList.map((b) => b.id)
    const yaba = await d.query.brandLocations.findFirst({ where: (l, { eq }) => eq(l.id, PICKUP_LOCATION) })

    await d.delete(shippingZones).where(inArray(shippingZones.brandId, ids))
    await d.delete(shippingClosures).where(inArray(shippingClosures.brandId, ids))

    for (const b of brandList) {
      const cur = b.currency
      const origin = b.shipsFrom
      const isLagos = b.id === "b_lagos_static"
      const profile = {
        brandId: b.id,
        originCountry: origin,
        originCity: b.city,
        timeZone: countryTimeZone[origin],
        handlingMin: b.processingDays[0],
        handlingMax: b.processingDays[1],
        cutoffLocal: "14:00",
        workdays: 31,
        providerId: "manual",
        currency: cur,
        localPickup: isLagos,
        pickupLocationId: isLagos && yaba ? PICKUP_LOCATION : null,
        updatedBy: null,
        updatedAt: ctx.now,
      }
      await d.insert(shippingProfiles).values(profile).onConflictDoUpdate({ target: shippingProfiles.brandId, set: profile })

      const regional = countryCodes.filter((c) => c !== origin && countries[c].region === countries[origin].region)
      const zones: { key: ShippingZone; name: string; countries: string[] }[] = [
        { key: "domestic", name: "Domestic", countries: [origin] },
        ...(regional.length ? [{ key: "regional" as const, name: "Regional", countries: regional }] : []),
        { key: "international", name: "International", countries: ["*"] },
      ]
      const threshold = round2(convert(freeShippingThresholdUsd, "USD", cur), cur)
      for (const [i, z] of zones.entries()) {
        const zoneId = `sz_seed_${short(b.id)}_${z.key.slice(0, 3)}`
        await d.insert(shippingZones).values({ id: zoneId, brandId: b.id, name: z.name, kind: z.key, countries: z.countries, enabled: true, position: i })
        const rate = shippingRatesUsd[z.key]
        const express = defaultExpressTransit(rate.days)
        const methods = [
          { service: "standard", label: "Standard", transit: rate.days, rates: [[0, round2(convert(rate.standard, "USD", cur), cur)], [threshold, 0]] },
          { service: "express", label: "Express", transit: express, rates: [[0, round2(convert(rate.express, "USD", cur), cur)]] },
          ...(isLagos && z.key === "domestic" ? [{ service: "pickup", label: "Pick up in store", transit: [0, 0] as [number, number], rates: [[0, 0]] }] : []),
        ]
        for (const [k, m] of methods.entries()) {
          const methodId = `sm_seed_${short(b.id)}_${z.key.slice(0, 3)}_${m.service}`
          await d.insert(shippingMethods).values({ id: methodId, zoneId, brandId: b.id, service: m.service, label: m.label, enabled: true, transitMin: m.transit[0], transitMax: m.transit[1], carrierLabel: null, position: k })
          await d.insert(shippingRates).values(m.rates.map(([min, amount], n) => ({ id: `sr_seed_${short(b.id)}_${z.key.slice(0, 3)}_${m.service}_${n}`, methodId, minSubtotalMinor: min, amountMinor: amount, currency: cur })))
        }
      }
    }
  },
}

export default seed
