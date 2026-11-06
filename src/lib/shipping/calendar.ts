/**
 * Business-day calendar (§6.5). Pure and isomorphic: relative imports only and no `server-only`,
 * so it runs in Next, in the browser and under `tsx --test` (§1.8). Dates are 'YYYY-MM-DD' in a
 * named zone; weekdays are read from Date.UTC(y, m, d, 12), so no local clock is involved.
 */
import type { Calendar, HolidayRef } from "./types"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d, 12))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number)
  return { y, m, d }
}

/** Noon UTC on a calendar date: a stable instant for weekday maths and formatting. */
export function noonUtc(date: string) {
  const { y, m, d } = parts(date)
  return Date.UTC(y, m - 1, d, 12)
}

/** A date moved by whole calendar days. */
export function addDays(date: string, n: number) {
  const t = new Date(noonUtc(date))
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/** Monday = 0 … Sunday = 6 (the workdays bit index). */
export function weekdayIndex(date: string) {
  return (new Date(noonUtc(date)).getUTCDay() + 6) % 7
}

/** Whole calendar days from a to b (b − a). */
export function daysBetween(a: string, b: string) {
  return Math.round((noonUtc(b) - noonUtc(a)) / 86_400_000)
}

export const maxDate = (a: string, b: string) => (a >= b ? a : b)
export const minDate = (a: string, b: string) => (a <= b ? a : b)

const dayFormatters = new Map<string, Intl.DateTimeFormat>()
const clockFormatters = new Map<string, Intl.DateTimeFormat>()

/** The calendar date at an instant in a time zone. */
export function dateIn(timeZone: string, ms: number) {
  let f = dayFormatters.get(timeZone)
  if (!f) {
    // en-CA formats as yyyy-mm-dd.
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    dayFormatters.set(timeZone, f)
  }
  return f.format(new Date(ms))
}

/** The wall-clock time 'HH:MM' at an instant in a time zone. */
export function localHHMM(ms: number, timeZone: string) {
  let f = clockFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    clockFormatters.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`
}

/** Mon–Fri. */
export const WEEKDAYS = 31

/** A calendar from a workdays mask, holiday entries and (optional) closure ranges. */
export function makeCalendar(workdays: number, holidays: Iterable<HolidayRef | string>, closures: Iterable<{ from: string; to: string }> = []): Calendar {
  const set = new Set<string>()
  const labels = new Map<string, HolidayRef>()
  for (const h of holidays) {
    if (typeof h === "string") set.add(h)
    else {
      set.add(h.date)
      if (!labels.has(h.date)) labels.set(h.date, h)
    }
  }
  const closed = new Set<string>()
  for (const c of closures) {
    if (!isDate(c.from) || !isDate(c.to) || c.to < c.from) continue
    // A closure longer than a year is a data error; cap it so a typo can't loop for ever.
    for (let d = c.from, i = 0; d <= c.to && i < 366; d = addDays(d, 1), i++) closed.add(d)
  }
  return { workdays: workdays & 127, holidays: set, closures: closed, labels }
}

/** Weekday bit set ∧ not a holiday ∧ not a closure. */
export function isBusinessDay(date: string, cal: Calendar) {
  if (!(cal.workdays & (1 << weekdayIndex(date)))) return false
  if (cal.holidays.has(date)) return false
  if (cal.closures?.has(date)) return false
  return true
}

/** A calendar with no working day would never return; refuse it. */
function assertWorks(cal: Calendar) {
  if (!(cal.workdays & 127)) throw new Error("calendar: no working weekday")
}

/** The first business day strictly after `date`. */
export function nextBusinessDay(date: string, cal: Calendar) {
  assertWorks(cal)
  let d = addDays(date, 1)
  // Holidays and closures can run long, but never more than a year.
  for (let i = 0; i < 400 && !isBusinessDay(d, cal); i++) d = addDays(d, 1)
  return d
}

/** n = 0: `date` when it is a business day, else the next one. n ≥ 1: the n-th business day strictly after `date`. */
export function addBusinessDays(date: string, n: number, cal: Calendar) {
  assertWorks(cal)
  if (n <= 0) return isBusinessDay(date, cal) ? date : nextBusinessDay(date, cal)
  let d = date
  for (let i = 0; i < n; i++) d = nextBusinessDay(d, cal)
  return d
}

/** Business days in (a, b], or 0 when b ≤ a. */
export function businessDaysBetween(a: string, b: string, cal: Calendar) {
  let n = 0
  for (let d = addDays(a, 1), i = 0; d <= b && i < 800; d = addDays(d, 1), i++) if (isBusinessDay(d, cal)) n++
  return n
}

/**
 * The day an order placed at `nowMs` counts from: today in the origin zone, or the next business
 * day when today isn't one or the local time is at or past the cutoff.
 */
export function orderDay(nowMs: number, o: { timeZone: string; cutoffLocal: string }, cal: Calendar) {
  const d = dateIn(o.timeZone, nowMs)
  if (!isBusinessDay(d, cal) || localHHMM(nowMs, o.timeZone) >= o.cutoffLocal) return nextBusinessDay(d, cal)
  return d
}

/** The holidays (with names) a calendar has between two dates, inclusive. */
export function holidaysBetween(from: string, to: string, cal: Calendar): HolidayRef[] {
  const out: HolidayRef[] = []
  if (!cal.labels) return out
  for (const [date, h] of cal.labels) if (date >= from && date <= to) out.push(h)
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** "Mon–Fri", "Mon–Sat", "Mon, Wed, Fri" for a workdays mask. */
export function workdaysLabel(mask: number) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  const on = names.map((n, i) => ((mask >> i) & 1 ? i : -1)).filter((i) => i >= 0)
  if (!on.length) return "No days"
  const contiguous = on.every((v, i) => i === 0 || v === on[i - 1] + 1)
  if (contiguous && on.length > 2) return `${names[on[0]]}–${names[on[on.length - 1]]}`
  return on.map((i) => names[i]).join(", ")
}
