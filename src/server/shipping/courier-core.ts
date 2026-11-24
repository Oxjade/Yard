import { createHash } from "node:crypto"
import type { CourierStatus } from "./providers/courier-types"

/**
 * Courier shipping rules with no I/O (docs/SHIPPING.md), shared by quoting, booking, the webhook
 * and the tests.
 */

/** What an order remembers about the courier rate the shopper paid (order_refs.quoted.courier). Never the request token. */
export type CourierChoice = {
  provider: string
  /** courier_quotes.id: the provider's request token stays in that row, server side. */
  quoteId: string
  courierId: string
  serviceCode: string
  name: string
  /** What the shopper paid for it (order currency = the provider's currency). */
  amountMinor: number
  currency: string
  eta: string | null
}

export const COURIER_PROVIDER_PREFIX = "courier:"
export const isCourierProviderId = (id: string | null | undefined) => !!id && id.startsWith(COURIER_PROVIDER_PREFIX)

/** The option key a shopper picks: stable across re-quotes for the same courier and service. */
export const courierOptionKey = (courierId: string, serviceCode: string) => `c:${courierId}:${serviceCode}`.replace(/[^\w:.-]/g, "_").slice(0, 80)

/** A stable hash of what a rate depends on (provider, both addresses, pickup day, parcel). */
export function quoteCacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

const pad = (n: number) => String(n).padStart(2, "0")

/** yyyy-mm-dd in a time zone. */
export function ymdIn(timeZone: string, ms: number) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms))
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay()

/**
 * When the courier should collect: after the brand's shortest handling time, on a weekday, at
 * least tomorrow and at most 6 days out (Shipbubble takes pickup dates up to 7 days ahead).
 */
export function pickupDateFor(nowMs: number, timeZone: string, handlingMin: number) {
  const today = ymdIn(timeZone, nowMs)
  let date = today
  let added = 0
  const want = Math.max(1, Math.min(5, handlingMin))
  for (let i = 0; i < 6 && added < want; i++) {
    date = addDays(date, 1)
    if (weekday(date) !== 0 && weekday(date) !== 6) added++
  }
  while (weekday(date) === 0 || weekday(date) === 6) date = addDays(date, 1)
  return date
}

/**
 * Whether booking can reuse the quote's request token: the provider still honours it, and its
 * pickup date hasn't passed (a courier can't collect yesterday). Otherwise booking re-quotes.
 */
export function tokenUsable(q: { tokenExpiresAt: Date; pickupDate: string | null }, nowMs: number, timeZone: string) {
  if (q.tokenExpiresAt.getTime() <= nowMs + 60_000) return false
  if (q.pickupDate && q.pickupDate < ymdIn(timeZone, nowMs)) return false
  return true
}

/**
 * A re-quote that costs more than the shopper paid: Yard pays the difference from the courier
 * wallet. Up to the cap that's silent; above it Admin is alerted (the booking still goes ahead,
 * so the brand's order isn't held up).
 */
export function absorbDecision(collectedMinor: number, costMinor: number, capMinor: number) {
  const diff = costMinor - collectedMinor
  return { diffMinor: diff, overCap: diff > capMinor }
}

/** The shipment states a "Book pickup" can come from: a paid order that hasn't shipped and isn't closed. */
export function bookRefusal(order: { status: string; paid: boolean }, quoted: { courier?: unknown } | null): string | null {
  if (!quoted?.courier) return "This order wasn't paid with a courier rate, so add tracking by hand."
  if (!order.paid) return "This order isn't paid yet. Don't ship it until it is."
  if (order.status === "cancelled" || order.status === "refunded") return `This order was ${order.status}, so there's nothing to ship.`
  if (order.status !== "paid" && order.status !== "processing") return "This order has already shipped."
  return null
}

const SHIPPED_STEPS = new Set(["shipped", "in_transit", "out_for_delivery", "delivered"])

/**
 * The shipment event a courier status adds to the order's timeline, given the events already on
 * it (each step once; nothing after delivery). Pending/confirmed add nothing: booking already
 * recorded "shipped".
 */
export function eventForCourierStatus(status: CourierStatus, existing: string[]): "shipped" | "in_transit" | "delivered" | "exception" | null {
  const has = (s: string) => existing.includes(s)
  if (has("delivered") || has("returned")) return null
  switch (status) {
    case "picked_up":
    case "in_transit":
      if (has("in_transit")) return null
      return existing.some((s) => SHIPPED_STEPS.has(s)) ? "in_transit" : "shipped"
    case "delivered":
      return "delivered"
    case "cancelled":
      return existing[existing.length - 1] === "exception" ? null : "exception"
    default:
      return null
  }
}

/** The courier_shipments.status a provider status moves a booked shipment to (never backwards). */
export function shipmentStateFor(current: string, status: CourierStatus): string {
  if (current === "delivered" || current === "cancelled") return current
  if (status === "delivered") return "delivered"
  if (status === "cancelled") return "cancelled"
  if ((status === "picked_up" || status === "in_transit") && current !== "in_transit") return "in_transit"
  return current
}

/**
 * What checkout offers: live courier rates replace the brand's own parcel rates (standard and
 * express) when there are any, and its store pickup stays. No courier rates (couriers off, no
 * address yet, the provider down or silent): the brand's own options, unchanged.
 */
export function mergeCourierOptions<T extends { service: string; available: boolean }>(manual: T[], live: T[]): T[] {
  if (!live.length) return manual
  return [...live, ...manual.filter((o) => o.service === "pickup" && o.available)]
}
