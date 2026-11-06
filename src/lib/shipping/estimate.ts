/**
 * The delivery-estimate engine (§6.5). Pure and isomorphic (relative imports only, no
 * `server-only`): the server computes quotes and order estimates with it, Studio's preview runs it
 * on unsaved form values, and the tests run it under `tsx --test`.
 *
 * An estimate is never a promise: `guaranteed` is always false here. Only a future carrier that
 * declares guaranteed dates may return one, and it doesn't come through this engine.
 */
import { addBusinessDays, dateIn, holidaysBetween, maxDate, nextBusinessDay, orderDay } from "./calendar"
import type { Calendar, Estimate, EstimateInput, HolidayRef } from "./types"

const base = (basis: Estimate["basis"]): Estimate => ({ basis, late: false, holidaysCrossed: [], guaranteed: false, isEstimate: true })

function crossed(from: string | undefined, to: string | undefined, cals: Calendar[]): HolidayRef[] {
  if (!from || !to || to < from) return []
  const seen = new Map<string, HolidayRef>()
  for (const cal of cals) for (const h of holidaysBetween(from, to, cal)) seen.set(`${h.country}:${h.date}:${h.name}`, h)
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country))
}

/** Clamp a [min, max] pair to whole, ordered, non-negative days. */
function span([a, b]: [number, number]): [number, number] {
  const lo = Math.max(0, Math.floor(a))
  const hi = Math.max(lo, Math.floor(b))
  return [lo, hi]
}

/** The plan from the order: dispatch window, ship-by and arrival window (`quote` / `placed`). */
function fromOrder(i: EstimateInput, at: number) {
  const [hMin, hMax] = span(i.handling)
  const [tMin, tMax] = span(i.transit)
  const d0 = orderDay(Math.max(at, i.releaseAtMs ?? 0), { timeZone: i.timeZone, cutoffLocal: i.cutoffLocal }, i.handlingCal)
  const dispatchFrom = addBusinessDays(d0, hMin, i.handlingCal)
  const shipBy = addBusinessDays(d0, hMax, i.handlingCal)
  const arrivalFrom = addBusinessDays(dispatchFrom, tMin, i.transitCal)
  const arrivalTo = addBusinessDays(shipBy, tMax, i.transitCal)
  return { d0, dispatchFrom, shipBy, arrivalFrom, arrivalTo }
}

export function estimateDelivery(i: EstimateInput): Estimate {
  const [tMin, tMax] = span(i.transit)
  const T = i.transitCal
  const H = i.handlingCal
  const a = i.anchor
  const cals = [H, T]

  switch (a.kind) {
    case "quote":
    case "placed": {
      const plan = fromOrder(i, a.at)
      const today = dateIn(i.timeZone, i.now)
      // Not shipped and past the ship-by date: late, re-planned from the next business day.
      if (a.kind === "placed" && !i.shipped && today > plan.shipBy) {
        const dispatchFrom = nextBusinessDay(today, H)
        const arrivalFrom = addBusinessDays(dispatchFrom, tMin, T)
        const arrivalTo = addBusinessDays(dispatchFrom, tMax, T)
        return { ...base("late"), late: true, dispatchFrom, shipBy: plan.shipBy, arrivalFrom, arrivalTo, holidaysCrossed: crossed(plan.d0, arrivalTo, cals) }
      }
      return { ...base(a.kind), dispatchFrom: plan.dispatchFrom, shipBy: plan.shipBy, arrivalFrom: plan.arrivalFrom, arrivalTo: plan.arrivalTo, holidaysCrossed: crossed(plan.d0, plan.arrivalTo, cals) }
    }
    case "shipped":
    case "in_transit": {
      const sd = dateIn(i.timeZone, a.at)
      let arrivalFrom = addBusinessDays(sd, tMin, T)
      let arrivalTo = addBusinessDays(sd, tMax, T)
      const today = dateIn(i.destTimeZone, i.now)
      if (today > arrivalTo) {
        // Past the window and not delivered: running late, with a fresh short window from today.
        arrivalTo = addBusinessDays(today, 2, T)
        arrivalFrom = nextBusinessDay(today, T)
        return { ...base("late"), late: true, arrivalFrom, arrivalTo, holidaysCrossed: crossed(sd, arrivalTo, [T]) }
      }
      return { ...base(a.kind), arrivalFrom, arrivalTo, holidaysCrossed: crossed(sd, arrivalTo, [T]) }
    }
    case "out_for_delivery": {
      const day = dateIn(i.destTimeZone, a.at)
      return { ...base("out_for_delivery"), arrivalFrom: day, arrivalTo: day }
    }
    case "exception": {
      const today = dateIn(i.destTimeZone, i.now)
      const prevTo = a.previous?.arrivalTo ?? today
      // The earlier start stays, unless it has already passed: a new estimate never starts in the past.
      const floor = nextBusinessDay(today, T)
      const arrivalFrom = a.previous?.arrivalFrom && a.previous.arrivalFrom > today ? a.previous.arrivalFrom : floor
      const arrivalTo = addBusinessDays(maxDate(today, prevTo), 3, T)
      return { ...base("exception"), late: true, arrivalFrom, arrivalTo: maxDate(arrivalTo, arrivalFrom), holidaysCrossed: crossed(today, arrivalTo, [T]) }
    }
    case "delivered":
      return { ...base("delivered"), deliveredOn: dateIn(i.destTimeZone, a.at) }
  }
}

/** Express transit when the merchant hasn't set one: half of standard, at least 1–2 days. */
export function defaultExpressTransit([tMin, tMax]: [number, number]): [number, number] {
  return [Math.max(1, Math.ceil(tMin / 2)), Math.max(2, Math.ceil(tMax / 2))]
}

/** Handling for a brand's lines: the element-wise max of the profile and each product's processing days. */
export function groupHandling(profile: [number, number], lines: { processingDays?: [number, number] }[]): [number, number] {
  let [lo, hi] = profile
  for (const l of lines) {
    if (!l.processingDays) continue
    lo = Math.max(lo, l.processingDays[0])
    hi = Math.max(hi, l.processingDays[1])
  }
  return [lo, Math.max(lo, hi)]
}
