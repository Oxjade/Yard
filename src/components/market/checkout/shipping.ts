import { shippingRatesUsd, shippingZone, type CountryCode } from "@/config/markets"
import type { BrandGroup } from "@/lib/cart"
import type { Brand } from "@/lib/data/types"

export type ShippingMethod = "standard" | "express"

export const shippingMethodLabel: Record<ShippingMethod, string> = {
  standard: "Standard",
  express: "Express",
}

/**
 * Shipping price for one brand order, in the shopper's currency. Express mirrors the
 * formula in useOrders().placeCheckout so the price shown here is the price recorded.
 */
export function shippingPrice(group: BrandGroup, method: ShippingMethod) {
  if (method === "standard") return group.shipping
  return Math.round(group.shipping * 1.9) || Math.round(group.subtotal * 0.04)
}

/** Business days from order to doorstep: the brand's processing time plus transit. */
export function deliveryDays(brand: Brand, shipTo: CountryCode, method: ShippingMethod): [number, number] {
  const rate = shippingRatesUsd[shippingZone(brand.shipsFrom, shipTo)]
  const transit: [number, number] =
    method === "express" ? [Math.max(1, Math.round(rate.days[0] / 2)), Math.max(2, Math.round(rate.days[1] / 2))] : rate.days
  return [brand.processingDays[0] + transit[0], brand.processingDays[1] + transit[1]]
}

export function methodFromLabel(label: string): ShippingMethod {
  return label.toLowerCase().startsWith("express") ? "express" : "standard"
}

function addBusinessDays(from: Date, days: number) {
  const d = new Date(from)
  let left = days
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) left -= 1
  }
  return d
}

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" })

/** "11–14 Nov" — call on the client only (it reads the clock through `from`). */
export function arrivalRange(from: Date, [min, max]: [number, number]) {
  return dayMonth.formatRange(addBusinessDays(from, min), addBusinessDays(from, max))
}
