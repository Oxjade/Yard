import { DEMO_TODAY } from "@/lib/data/seed"

/**
 * Pure helpers that turn daily rows and dated events into what the insight charts show.
 * Everything here derives from data the page already has; nothing is generated.
 * Dates are "YYYY-MM-DD" in UTC, so server and client agree.
 */

export type Bucket = "daily" | "weekly" | "monthly"

/**
 * Bucket sizes for the bar chart. Weekly and monthly buckets are rolling windows that end
 * today, so no bucket is a partial week or month and every bar compares like with like.
 * The sample order history covers the last 90 days, which is why "Monthly" is three
 * 30-day windows rather than six calendar months.
 */
export const buckets: Record<Bucket, { size: number; count: number; label: string; window: string }> = {
  daily: { size: 1, count: 14, label: "Daily", window: "last 14 days" },
  weekly: { size: 7, count: 12, label: "Weekly", window: "last 12 weeks" },
  monthly: { size: 30, count: 3, label: "Monthly", window: "last 90 days" },
}

const utc = (date: string) => new Date(`${date}T12:00:00Z`)

export function shortDate(date: string) {
  return utc(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}

export function longDate(date: string) {
  return utc(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

export function rangeLabel(from: string, to: string) {
  return from === to ? longDate(from) : `${shortDate(from)} to ${shortDate(to)}`
}

export function addDays(date: string, days: number) {
  const d = utc(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const today = DEMO_TODAY

/** Change as a ratio, or null when there is nothing honest to compare with. */
export function change(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous <= 0) return null
  return (current - previous) / previous
}

export type Slice<T> = { from: string; to: string; rows: T[]; previous: T[] | null }

/**
 * The last `count` windows of `size` rows, oldest first. Each window carries the window
 * before it, but only when that window lies wholly inside the recorded history (so a
 * truncated sample history never produces a fake "+4,000%").
 */
export function slices<T extends { date: string }>(rows: T[], size: number, count: number, historyStart: string): Slice<T>[] {
  const out: Slice<T>[] = []
  for (let k = count - 1; k >= 0; k--) {
    const end = rows.length - k * size
    const start = end - size
    if (start < 0) continue
    const slice = rows.slice(start, end)
    const prev = start - size >= 0 ? rows.slice(start - size, start) : null
    out.push({ from: slice[0].date, to: slice[slice.length - 1].date, rows: slice, previous: prev && prev[0].date >= historyStart ? prev : null })
  }
  return out
}

/** The selected period and the one before it, with the previous one dropped when it predates the history. */
export function periodWindows<T extends { date: string }>(rows: T[], days: number, historyStart: string) {
  const current = rows.slice(-days)
  const prevStart = rows.length - days * 2
  const previous = prevStart >= 0 ? rows.slice(prevStart, rows.length - days) : []
  return { current, previous, comparable: previous.length === days && previous[0].date >= historyStart, from: current[0]?.date ?? today }
}

/* ── Weekday × week ─────────────────────────────────────────────────── */

export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
const weekdayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

export type HeatCell = { date: string; value: number; state: "data" | "future" | "before" }

/**
 * Counts per day laid out as weekday rows (Mon–Sun) × week columns, ending with the
 * current week. Days after today are "future"; days before the history are "before".
 */
export function weekdayByWeek(dates: string[], weeks: number, historyStart: string) {
  const counts = new Map<string, number>()
  for (const d of dates) counts.set(d, (counts.get(d) ?? 0) + 1)
  const dow = (utc(today).getUTCDay() + 6) % 7 // Monday = 0
  const firstMonday = addDays(today, -dow - 7 * (weeks - 1))
  const columns = Array.from({ length: weeks }, (_, c) => addDays(firstMonday, c * 7))
  const cells: HeatCell[][] = weekdays.map((_, r) =>
    columns.map((monday) => {
      const date = addDays(monday, r)
      const state: HeatCell["state"] = date > today ? "future" : date < historyStart ? "before" : "data"
      return { date, value: state === "data" ? (counts.get(date) ?? 0) : 0, state }
    }),
  )
  const data = cells.flat().filter((c) => c.state === "data")
  const total = data.reduce((s, c) => s + c.value, 0)
  const perWeekday = cells.map((row) => row.reduce((s, c) => s + c.value, 0))
  const busiest = perWeekday.indexOf(Math.max(...perWeekday))
  const max = Math.max(0, ...data.map((c) => c.value))
  const maxDays = max ? data.filter((c) => c.value === max).length : 0
  // A peak only when one day stands alone; ties have no single peak.
  const peak = maxDays === 1 ? (data.find((c) => c.value === max) ?? null) : null
  return {
    columns,
    cells,
    total,
    days: data.length,
    from: data.length ? data.reduce((m, c) => (c.date < m ? c.date : m), data[0].date) : today,
    busiestWeekday: total ? { name: weekdayNames[busiest], share: perWeekday[busiest] / total } : null,
    weekendShare: total ? (perWeekday[5] + perWeekday[6]) / total : null,
    max,
    maxDays,
    peak,
  }
}
