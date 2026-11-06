import { optionFor, type BrandGroup, type ShippingService } from "@/lib/cart"
import type { EstimateDto } from "@/lib/api/contracts/shipping"
import { formatRange, formatShortRange } from "@/lib/shipping/format"

/**
 * Thin wrappers over the server's quote (§6.5), kept so their callers read the same. Prices,
 * transit times and arrival ranges come only from the quote: there is no formula here, and with no
 * quote the answer is null (callers show a Bone or "Shipping is calculated at checkout").
 */

export type ShippingMethod = ShippingService

export const shippingMethodLabel: Record<ShippingMethod, string> = {
  standard: "Standard",
  express: "Express",
  pickup: "Pickup",
}

/** The option for a method in this group's quote, or null (not offered, or no quote yet). */
export function quotedOption(group: BrandGroup, method: ShippingMethod) {
  const o = group.options?.find((x) => x.service === method && x.available)
  return o ?? null
}

/** Shipping price for one brand order in the shopper's currency, from the quote; null without one. */
export function shippingPrice(group: BrandGroup, method: ShippingMethod): number | null {
  return quotedOption(group, method)?.price.amount ?? null
}

/** Business days from order to doorstep (handling plus transit) for a method, from the quote; null without one. */
export function deliveryDays(group: BrandGroup, method: ShippingMethod): [number, number] | null {
  const o = quotedOption(group, method)
  if (!o || !group.quote) return null
  return [group.quote.handling[0] + o.transit[0], group.quote.handling[1] + o.transit[1]]
}

/** The method a stored label names ("Express, international" → express). */
export function methodFromLabel(label: string): ShippingMethod {
  const l = label.toLowerCase()
  return l.startsWith("express") ? "express" : l.startsWith("pick") ? "pickup" : "standard"
}

/** "Wed 11 – Mon 16 Nov" from an estimate, or null when it has no arrival range. */
export function arrivalRange(estimate: Pick<EstimateDto, "arrivalFrom" | "arrivalTo"> | null | undefined, short = false) {
  if (!estimate?.arrivalFrom || !estimate.arrivalTo) return null
  return short ? formatShortRange(estimate.arrivalFrom, estimate.arrivalTo) : formatRange(estimate.arrivalFrom, estimate.arrivalTo)
}

/** The option a review row shows for a brand: the chosen method when offered, else the default. */
export function chosenOption(group: BrandGroup, method: ShippingMethod) {
  return optionFor(group.options, method)
}
