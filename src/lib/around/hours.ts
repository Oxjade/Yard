/**
 * Opening hours and dates for places (§6.4), computed in the place's own time zone. Pure and
 * isomorphic, so the server, the cards and the hours table agree.
 */

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const
export type DayKey = (typeof DAYS)[number]
export type HoursRange = [string, string]
export type PlaceHours = Record<DayKey, HoursRange[] | null>

export const dayLabels: Record<DayKey, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" }
export const dayShort: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" }

const parts = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string) {
  let f = parts.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    parts.set(tz, f)
  }
  return f
}

const weekdayKey: Record<string, DayKey> = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" }

/** The weekday and minutes after midnight at an instant, in a zone. */
export function localClock(at: number, tz: string): { day: DayKey; minutes: number } {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(at)).map((x) => [x.type, x.value]))
  return { day: weekdayKey[p.weekday] ?? "mon", minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) }
}

export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + m
}

const prevDay = (d: DayKey): DayKey => DAYS[(DAYS.indexOf(d) + 6) % 7]
const nextDay = (d: DayKey): DayKey => DAYS[(DAYS.indexOf(d) + 1) % 7]

export type OpenState =
  | { open: true; closes: string }
  | { open: false; opens?: { day: DayKey; time: string; today: boolean; tomorrow: boolean } }

/**
 * Open now? Ranges may end at 24:00 or after midnight ("22:00"–"02:00"), in which case the
 * late part counts on the next calendar day.
 */
export function openState(hours: PlaceHours | null | undefined, tz: string, at: number): OpenState | null {
  if (!hours) return null
  const { day, minutes } = localClock(at, tz)
  for (const [o, c] of hours[day] ?? []) {
    const from = toMinutes(o)
    let to = toMinutes(c)
    if (to <= from) to += 24 * 60
    if (minutes >= from && minutes < to) return { open: true, closes: c === "24:00" ? "midnight" : c }
  }
  for (const [o, c] of hours[prevDay(day)] ?? []) {
    const from = toMinutes(o)
    const to = toMinutes(c)
    if (to <= from && minutes < to) return { open: true, closes: c }
  }
  // The next opening within a week.
  let d = day
  for (let i = 0; i < 8; i++) {
    const ranges = [...(hours[d] ?? [])].sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]))
    for (const [o] of ranges) {
      if (i === 0 && toMinutes(o) <= minutes) continue
      return { open: false, opens: { day: d, time: o, today: i === 0, tomorrow: i === 1 } }
    }
    d = nextDay(d)
  }
  return { open: false }
}

/** "Open, closes 19:00" / "Closed, opens 10:00" / "Closed, opens Tue 10:00" / "Closed today". */
export function openLine(state: OpenState | null): string | null {
  if (!state) return null
  if (state.open) return `Open, closes ${state.closes}`
  if (!state.opens) return "Closed"
  if (state.opens.today) return `Closed, opens ${state.opens.time}`
  if (state.opens.tomorrow) return `Closed, opens tomorrow ${state.opens.time}`
  return `Closed, opens ${dayShort[state.opens.day]} ${state.opens.time}`
}

export function hasAnyHours(hours: PlaceHours | null | undefined) {
  return !!hours && DAYS.some((d) => (hours[d] ?? []).length > 0)
}

/** "10:00–19:00", "10:00–14:00, 15:00–19:00" or "Closed". */
export const rangesLabel = (ranges: HoursRange[] | null | undefined) => (ranges && ranges.length ? ranges.map(([o, c]) => `${o}–${c}`).join(", ") : "Closed")

/* ---------- Dates ---------- */

const dayFmt = new Map<string, Intl.DateTimeFormat>()
const dayFormatter = (tz: string, withTime: boolean) => {
  const key = `${tz}|${withTime}`
  let f = dayFmt.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}) })
    dayFmt.set(key, f)
  }
  return f
}

/** "Sat 7 Nov" in a zone. */
export const dayIn = (at: number | string, tz: string) => dayFormatter(tz, false).format(new Date(at)).replace(",", "")
/** "Sat 7 Nov, 12:00" in a zone. */
export const dayTimeIn = (at: number | string, tz: string) => {
  const p = Object.fromEntries(dayFormatter(tz, true).formatToParts(new Date(at)).map((x) => [x.type, x.value]))
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute}`
}
/** "12:00" in a zone. */
export const timeIn = (at: number | string, tz: string) => {
  const p = Object.fromEntries(dayFormatter(tz, true).formatToParts(new Date(at)).map((x) => [x.type, x.value]))
  return `${p.hour}:${p.minute}`
}

/** "Sat 7 – Sun 8 Nov", "Sat 7 Nov", "Sat 31 Oct – Sun 1 Nov". */
export function dateRange(startsAt: string | number, endsAt: string | number, tz: string) {
  const a = dayFormatter(tz, false).formatToParts(new Date(startsAt))
  // An end at midnight belongs to the day before.
  const endAt = new Date(endsAt).getTime() - 1
  const b = dayFormatter(tz, false).formatToParts(new Date(endAt))
  const pa = Object.fromEntries(a.map((x) => [x.type, x.value]))
  const pb = Object.fromEntries(b.map((x) => [x.type, x.value]))
  if (pa.day === pb.day && pa.month === pb.month) return `${pa.weekday} ${pa.day} ${pa.month}`
  if (pa.month === pb.month) return `${pa.weekday} ${pa.day} – ${pb.weekday} ${pb.day} ${pb.month}`
  return `${pa.weekday} ${pa.day} ${pa.month} – ${pb.weekday} ${pb.day} ${pb.month}`
}

/** The short zone name ("WAT", "GMT+1") at an instant. */
export function zoneShort(tz: string, at: number) {
  const known: Record<string, string> = { "Africa/Lagos": "WAT", "Africa/Accra": "GMT", "Africa/Nairobi": "EAT", "Africa/Johannesburg": "SAST" }
  if (known[tz]) return known[tz]
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? tz
}

/** Whether two zones show the same wall clock right now (so the hours table can skip the zone name). */
export function sameClock(a: string, b: string, at: number) {
  const x = localClock(at, a)
  const y = localClock(at, b)
  return x.day === y.day && x.minutes === y.minutes
}

export type TimedStatus = "upcoming" | "live" | "ended"
export function timedStatus(startsAt: string | null, endsAt: string | null, at: number): TimedStatus | null {
  if (!startsAt || !endsAt) return null
  const s = Date.parse(startsAt)
  const e = Date.parse(endsAt)
  if (at >= e) return "ended"
  if (at >= s) return "live"
  return "upcoming"
}

/* ---------- Brand-local date and time fields (Studio) ---------- */

const localFmt = new Map<string, Intl.DateTimeFormat>()

/** A UTC instant → the wall-clock date and time in a zone, as form values ("2026-11-07", "12:00"). */
export function localParts(at: number | string, tz: string): { date: string; time: string } {
  let f = localFmt.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    localFmt.set(tz, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}

export { zonedTimeToUtc } from "@/lib/data/zones"
