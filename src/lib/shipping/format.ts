/**
 * Formatting for delivery dates (§6.5). These are calendar dates, so there is no time-zone
 * conversion: every date is read at noon UTC and formatted in UTC, en-GB. Plain Node, relative
 * imports only (§1.8).
 */
import { noonUtc } from "./calendar"

const weekdayDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" })
const weekdayDayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })
const month = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" })
const year = (d: string) => d.slice(0, 4)
const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7)

/** Intl puts a comma between weekday and day in some engines ("Wed, 11"); Yard reads "Wed 11". */
const tidy = (s: string) => s.replace(",", "")

/** "Tue 10 Nov". */
export function formatDay(date: string) {
  return tidy(weekdayDayMonth.format(noonUtc(date)))
}

/** "10 Nov". */
export function formatDayShort(date: string) {
  return dayMonth.format(noonUtc(date))
}

/**
 * "Wed 11 – Mon 16 Nov" (same month collapsed), "Mon 30 Nov – Wed 2 Dec", "Wed 30 Dec 2026 – Mon 4
 * Jan 2027" across a year, "Wed 11 Nov" when both ends are the same day.
 */
export function formatRange(from: string, to: string) {
  if (from === to) return formatDay(from)
  const a = noonUtc(from)
  const b = noonUtc(to)
  if (year(from) !== year(to)) return `${formatDay(from)} ${year(from)} – ${formatDay(to)} ${year(to)}`
  if (sameMonth(from, to)) return `${tidy(weekdayDay.format(a))} – ${tidy(weekdayDay.format(b))} ${month.format(b)}`
  return `${formatDay(from)} – ${formatDay(to)}`
}

/** "11–16 Nov", "30 Nov – 2 Dec", "16 Nov": for chips and notifications. */
export function formatShortRange(from: string, to: string) {
  if (from === to) return formatDayShort(from)
  if (sameMonth(from, to)) return `${Number(from.slice(8))}–${formatDayShort(to)}`
  return `${formatDayShort(from)} – ${formatDayShort(to)}`
}

/** "1–3 business days", "1 business day", "the same business day" (for "dispatches in …"). */
export function businessDays([a, b]: [number, number]) {
  if (b <= 0) return "the same business day"
  if (a === b) return `${a} business ${a === 1 ? "day" : "days"}`
  return `${a}–${b} business days`
}
