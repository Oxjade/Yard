/**
 * The iOS order-tracking Live Activity's state, computed on the server exactly as the app computes
 * it, so a push and an in-app refresh show the same thing.
 *
 * PORT OF `ios/Yard/Features/LiveActivity/LiveActivityOrder.swift` › `LiveActivityOrder.make(...)`
 * (branch mobileYard) and the ContentState in `…/Shared/YardOrderActivityAttributes.swift`.
 * Change both together: the cases in live-activity-state.test.ts are the same as the app's
 * `LiveActivityOrderTests.swift`. The inputs are the same DTOs the app reads (GET /api/orders/{id}
 * and GET /api/orders/{id}/delivery, plus the brand's city), and `timeZone` is the phone's, so
 * calendar dates become the same instants the app's `TimeZone.current` gives.
 *
 * Pure: no database, no network, no "server-only" (tsx --test runs it).
 */

/** `YardOrderActivityAttributes.Step` raw values (the push payload's `step`). */
export const LIVE_STEPS = ["packed", "shipped", "outForDelivery", "arrivingSoon", "delivered"] as const
export type LiveStep = (typeof LIVE_STEPS)[number]

/** `Step.baseProgress`. */
export const BASE_PROGRESS: Record<LiveStep, number> = { packed: 0.08, shipped: 0.25, outForDelivery: 0.82, arrivingSoon: 0.7, delivered: 1.0 }

/** `YardOrderActivityAttributes.ContentState`, with `etaDate` as epoch milliseconds (null = unknown). */
export type LiveState = { step: LiveStep; etaMs: number | null; progress: number; statusLine: string }

/** What the app reads from GET /api/orders/{id} (`LiveActivityOrderDTO`). */
export type LiveOrderInput = {
  brand?: { name?: string | null } | null
  shipToPreview?: { city?: string | null } | null
  states?: { fulfilment?: string | null } | null
  deliveredAt?: string | null
} | null

/** What the app reads from GET /api/orders/{id}/delivery (`LiveActivityDeliveryDTO`). */
export type LiveDeliveryInput = {
  estimate?: { basis?: string | null; arrivalFrom?: string | null; arrivalTo?: string | null; deliveredOn?: string | null; late?: boolean | null } | null
  shippedOn?: string | null
  shipTo?: { city?: string | null } | null
  events?: { status?: string | null; occurredAt?: string | null }[] | null
} | null

export type LiveActivityResult = {
  brandName: string
  brandCity: string
  deliveryCity: string
  /** The state to show, or null when the order shouldn't be tracked (not shipped yet). */
  state: LiveState | null
  /** The order is over without a delivery (cancelled, returned): end the activity. */
  closed: boolean
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1)

/** `ContentState.init` clamps progress to 0…1. */
const makeState = (step: LiveStep, etaMs: number | null, progress: number, statusLine: string): LiveState => ({ step, etaMs, progress: clamp01(progress), statusLine })

/* ---------- Dates (YardDate.parse and LiveActivityDates) ---------- */

/** `YardDate.parse`: an ISO timestamp (with or without fraction) or a bare yyyy-MM-dd (UTC midnight). */
export function parseApiDate(s: string | null | undefined): number | null {
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))?$/.test(s)) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : null
}

/** A valid IANA zone, else UTC. */
const validZones = new Map<string, boolean>()
export function safeTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC"
  let ok = validZones.get(tz)
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz })
      ok = true
    } catch {
      ok = false
    }
    if (validZones.size < 500) validZones.set(tz, ok)
  }
  return ok ? tz : "UTC"
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
/** The zone's UTC offset at an instant, in ms (local = utc + offset). */
function offsetMs(instant: number, tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    fmtCache.set(tz, f)
  }
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(new Date(instant))) if (part.type !== "literal") p[part.type] = Number(part.value)
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!)
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** `LiveActivityDates.startOfDay`: local midnight (in `tz`) of a yyyy-MM-dd date (a full ISO timestamp is cut to its date). */
export function startOfDay(s: string | null | undefined, tz: string): number | null {
  if (!s || s.length < 10) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.slice(0, 10))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const guess = Date.UTC(y, mo - 1, d)
  const check = new Date(guess)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  const zone = safeTimeZone(tz)
  let t = guess - offsetMs(guess, zone)
  t = guess - offsetMs(t, zone)
  return t
}

/** `LiveActivityDates.endOfArrivalDay`: local midnight + 20 hours ("arrives by the end of that day"). */
export function endOfArrivalDay(s: string | null | undefined, tz: string): number | null {
  const start = startOfDay(s, tz)
  return start == null ? null : start + 20 * 3_600_000
}

const lowercasedFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s)

const SHIPPED_STATUSES = new Set(["shipped", "in_transit", "out_for_delivery"])

/**
 * `LiveActivityOrder.make(orderId:order:delivery:brandCity:now:)`, line for line.
 * `now` is epoch ms; `timeZone` is the phone's zone (the app's TimeZone.current).
 */
export function liveActivityFor(order: LiveOrderInput, delivery: LiveDeliveryInput, brandCity: string, now: number, timeZone: string): LiveActivityResult {
  const tz = safeTimeZone(timeZone)
  const brandName = order?.brand?.name ?? "The brand"
  const deliveryCity = delivery?.shipTo?.city ?? order?.shipToPreview?.city ?? ""
  const fulfilment = order?.states?.fulfilment ?? ""

  const result = (state: LiveState | null, closed = false): LiveActivityResult => ({ brandName, brandCity, deliveryCity, state, closed })

  if (fulfilment === "cancelled" || fulfilment === "returned_to_sender") return result(null, true)

  const DISTANT_PAST = -62135769600000
  const events = [...(delivery?.events ?? [])]
    .map((e, i) => ({ e, i, t: parseApiDate(e.occurredAt) ?? DISTANT_PAST }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e)
  const statuses = events.map((e) => e.status).filter((s): s is string => typeof s === "string")
  if (statuses.includes("returned")) return result(null, true)

  const estimate = delivery?.estimate
  const isDelivered = fulfilment === "delivered" || statuses.includes("delivered") || !!estimate?.deliveredOn || !!order?.deliveredAt
  if (isDelivered) return result(makeState("delivered", null, 1, "Delivered"))

  const eta = endOfArrivalDay(estimate?.arrivalTo ?? estimate?.arrivalFrom, tz)
  const arrivalStart = startOfDay(estimate?.arrivalFrom ?? estimate?.arrivalTo, tz)
  const isLate = (estimate?.late ?? false) || estimate?.basis === "late"
  const latestShipment = [...statuses].reverse().find((s) => s !== "exception")
  const lastIsException = statuses[statuses.length - 1] === "exception"
  const hasShipped = fulfilment === "shipped" || statuses.some((s) => SHIPPED_STATUSES.has(s))

  if (latestShipment === "out_for_delivery") {
    const line = deliveryCity ? `Out for delivery in ${deliveryCity}` : "Out for delivery"
    return result(makeState("outForDelivery", eta, BASE_PROGRESS.outForDelivery + 0.04, line))
  }

  if (hasShipped) {
    const shippedEvent = events.find((e) => SHIPPED_STATUSES.has(e.status ?? ""))
    const shippedAt = parseApiDate(shippedEvent?.occurredAt) ?? startOfDay(delivery?.shippedOn, tz)
    let progress = BASE_PROGRESS.shipped
    if (shippedAt != null && eta != null && eta > shippedAt) {
      const fraction = (now - shippedAt) / (eta - shippedAt)
      progress = 0.25 + 0.53 * Math.min(Math.max(fraction, 0), 1)
    }
    const arrivingSoon = arrivalStart != null && now >= arrivalStart
    if (arrivingSoon) {
      const line = deliveryCity ? `Arriving soon in ${deliveryCity}` : "Arriving soon"
      return result(makeState("arrivingSoon", eta, Math.max(progress, BASE_PROGRESS.arrivingSoon), isLate ? `Running late — ${lowercasedFirst(line)}` : line))
    }
    let line: string
    if (lastIsException) line = `Delayed — ${brandName} reported a delay`
    else if (isLate) line = "Running late — new estimate"
    else if (brandCity) line = `On its way from ${brandCity}`
    else line = "On its way"
    return result(makeState("shipped", eta, progress, line))
  }

  if (fulfilment === "processing" || statuses.includes("label_created")) {
    return result(makeState("packed", eta, BASE_PROGRESS.packed, `Packed by ${brandName}`))
  }
  return result(null)
}
