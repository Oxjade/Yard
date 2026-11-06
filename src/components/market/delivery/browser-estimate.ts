import { holidays } from "@/config/holidays"
import { shippingRatesUsd, shippingZone, type CountryCode } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { productById } from "@/lib/data/products"
import type { DeliverySnapshot, MerchantOrder } from "@/lib/data/types"
import { countryTimeZone } from "@/lib/data/zones"
import { makeCalendar, WEEKDAYS } from "@/lib/shipping/calendar"
import { defaultExpressTransit, estimateDelivery, groupHandling } from "@/lib/shipping/estimate"
import type { Calendar, EstimateInput } from "@/lib/shipping/types"

const calendars = new Map<string, Calendar>()
function calendarFor(country: string): Calendar {
  let c = calendars.get(country)
  if (!c) {
    const list = holidays[country as keyof typeof holidays] ?? []
    c = makeCalendar(WEEKDAYS, list.map((h) => ({ date: h.date, name: h.name, country })))
    calendars.set(country, c)
  }
  return c
}

const service = (o: MerchantOrder): "standard" | "express" | "pickup" => (/^express/i.test(o.shippingMethod) ? "express" : /^pick/i.test(o.shippingMethod) ? "pickup" : "standard")

/**
 * An estimate computed in this browser, for orders the server never saw (placed here before v2)
 * and sample orders without a server estimate. The same engine and holiday calendar as the server,
 * with the brand's catalogue handling time and the platform's demo transit times. Always labelled
 * "Estimated in this browser" where it shows (§6.5, §10).
 */
export function browserEstimate(order: MerchantOrder, now = Date.now()): DeliverySnapshot {
  const brand = brandById.get(order.brandId)
  const origin = (brand?.shipsFrom ?? "NG") as CountryCode
  const dest = order.shippingAddress.country
  const svc = service(order)
  const days = shippingRatesUsd[shippingZone(origin, dest)].days
  const transit: [number, number] = svc === "express" ? defaultExpressTransit(days) : svc === "pickup" ? [0, 0] : days
  const handling = groupHandling(brand?.processingDays ?? [1, 3], order.lines.map((l) => ({ processingDays: productById.get(l.productId)?.processingDays })))
  const base: Omit<EstimateInput, "anchor"> = {
    handlingCal: calendarFor(origin),
    transitCal: calendarFor(dest),
    timeZone: countryTimeZone[origin],
    destTimeZone: countryTimeZone[dest] ?? "UTC",
    cutoffLocal: "14:00",
    handling,
    transit,
    now,
  }
  const at = (re: RegExp) => order.timeline.find((t) => re.test(t.label))?.at
  const delivered = order.deliveredAt ?? [...order.timeline].reverse().find((t) => /^(marked )?delivered\b/i.test(t.label))?.at
  const shipped = order.shippedAt ?? at(/^shipped\b/i)
  const e = delivered
    ? estimateDelivery({ ...base, anchor: { kind: "delivered", at: Date.parse(delivered) } })
    : shipped
      ? estimateDelivery({ ...base, anchor: { kind: "shipped", at: Date.parse(shipped) } })
      : // Only a paid order can run late: an unpaid one shouldn't ship at all.
        estimateDelivery({ ...base, anchor: { kind: "placed", at: Date.parse(order.placedAt) }, shipped: order.status !== "paid" && order.status !== "processing" })
  return {
    basis: e.basis,
    dispatchFrom: e.dispatchFrom,
    shipBy: e.shipBy,
    arrivalFrom: e.arrivalFrom,
    arrivalTo: e.arrivalTo,
    deliveredOn: e.deliveredOn,
    late: e.late,
    guaranteed: false,
    service: svc,
    source: "browser",
    computedAt: new Date(now).toISOString(),
  }
}

/** The order's stored estimate (from the server), else one computed in this browser. */
export function orderEstimate(order: MerchantOrder, now = Date.now()): DeliverySnapshot {
  return order.delivery ?? browserEstimate(order, now)
}
