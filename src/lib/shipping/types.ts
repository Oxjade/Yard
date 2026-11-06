/**
 * Delivery-estimate types (§6.5). Plain TypeScript with no imports: these load under Next, in the
 * browser and under `tsx --test` alike (§1.8). Every date is a calendar date, 'YYYY-MM-DD', read
 * in a named time zone; nothing here converts dates between zones.
 */

/** A holiday as the engine names it when an estimate crosses it. */
export type HolidayRef = { date: string; name: string; country: string }

/**
 * A working calendar. `workdays` is a bitmask: bit0 = Monday … bit6 = Sunday (31 = Mon–Fri).
 * `holidays` and `closures` are sets of dates; `labels` names the holidays, so an estimate can say
 * which ones it crossed.
 */
export type Calendar = {
  workdays: number
  holidays: Set<string>
  closures?: Set<string>
  labels?: Map<string, HolidayRef>
}

export type EstimateBasis = "quote" | "placed" | "shipped" | "in_transit" | "out_for_delivery" | "delivered" | "late" | "exception"

/**
 * An estimate. Never a promise: `guaranteed` is false for every provider in this build and
 * `isEstimate` is always true, so no caller can render it as an exact date.
 */
export type Estimate = {
  basis: EstimateBasis
  dispatchFrom?: string
  shipBy?: string
  arrivalFrom?: string
  arrivalTo?: string
  deliveredOn?: string
  late: boolean
  holidaysCrossed: HolidayRef[]
  guaranteed: false
  isEstimate: true
}

/** What the estimate is anchored to. `quote` and `placed` start from the order; the rest from a shipment event. */
export type EstimateAnchor =
  | { kind: "quote" | "placed"; at: number }
  | { kind: "shipped" | "in_transit" | "out_for_delivery" | "delivered"; at: number }
  /** A delay or carrier problem: keeps the earlier arrivalFrom and pushes arrivalTo out. */
  | { kind: "exception"; at: number; previous?: Pick<Estimate, "arrivalFrom" | "arrivalTo"> }

export type EstimateInput = {
  /** Origin workdays + origin-country holidays + brand closures. */
  handlingCal: Calendar
  /** Mon–Fri + destination-country holidays. */
  transitCal: Calendar
  /** The brand's (origin) time zone, where the cutoff and dispatch days are read. */
  timeZone: string
  /** The destination's time zone, where delivery days are read. */
  destTimeZone: string
  /** 'HH:MM' local to the origin. */
  cutoffLocal: string
  handling: [number, number]
  transit: [number, number]
  anchor: EstimateAnchor
  now: number
  /** An unreleased drop: the order counts from its release. */
  releaseAtMs?: number
  /** Whether a 'shipped' event has been recorded (late rules differ before and after it). */
  shipped?: boolean
}
