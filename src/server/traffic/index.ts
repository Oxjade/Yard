import "server-only"
import { and, gte, lte, sql } from "drizzle-orm"
import { db, t } from "../db"
import { log } from "../log"

/**
 * Site traffic by visitor country (admin Traffic). Page views arrive from POST /api/visit and are
 * counted in memory, then written once a minute as one upsert per (day, country) row, so database
 * work grows with time, not with traffic. A restart loses at most the last minute of counts.
 * Nothing about a visitor is stored except which country the visit came from.
 */
type Counts = { views: number; visitors: number }
type State = { pending: Map<string, Counts>; timer: ReturnType<typeof setInterval> | null; flushing: Promise<void> | null }

const FLUSH_MS = 60_000
const MAX_KEYS = 5_000
export const UNKNOWN_COUNTRY = "ZZ"

const g = globalThis as typeof globalThis & { __yardTraffic?: State }
const state = (): State => (g.__yardTraffic ??= { pending: new Map(), timer: null, flushing: null })

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10)

/** Counts one page view; `newVisitor` when it is this browser's first view of the UTC day. */
export function recordVisit(country: string | null, newVisitor: boolean, at = new Date()) {
  const s = state()
  const key = `${utcDay(at)}|${country ?? UNKNOWN_COUNTRY}`
  let c = s.pending.get(key)
  if (!c) {
    if (s.pending.size >= MAX_KEYS) return
    c = { views: 0, visitors: 0 }
    s.pending.set(key, c)
  }
  c.views++
  if (newVisitor) c.visitors++
  if (!s.timer) {
    s.timer = setInterval(() => void flushTraffic(), FLUSH_MS)
    s.timer.unref?.()
  }
}

/** Writes the pending counts. Safe to call any time; concurrent calls share one write. */
export function flushTraffic(): Promise<void> {
  const s = state()
  return (s.flushing ??= (async () => {
    if (s.pending.size === 0) return
    const batch = s.pending
    s.pending = new Map()
    const rows = [...batch].map(([key, c]) => {
      const [day, country] = key.split("|") as [string, string]
      return { day, country, views: c.views, visitors: c.visitors }
    })
    try {
      await (await db())
        .insert(t.trafficDaily)
        .values(rows)
        .onConflictDoUpdate({
          target: [t.trafficDaily.day, t.trafficDaily.country],
          set: { views: sql`${t.trafficDaily.views} + excluded.views`, visitors: sql`${t.trafficDaily.visitors} + excluded.visitors` },
        })
    } catch (err) {
      // Put the counts back so the next flush retries them.
      for (const r of rows) {
        const k = `${r.day}|${r.country}`
        const c = s.pending.get(k) ?? { views: 0, visitors: 0 }
        c.views += r.views
        c.visitors += r.visitors
        s.pending.set(k, c)
      }
      log.once("traffic:flush", "warn", `[yard] traffic flush failed, will retry: ${(err as Error).message}`)
    }
  })().finally(() => (s.flushing = null)))
}

export type TrafficCountry = { country: string; views: number; visitors: number }
export type TrafficReport = {
  days: number
  from: string
  to: string
  totals: { views: number; visitors: number; countries: number }
  countries: TrafficCountry[]
  daily: { day: string; views: number; visitors: number }[]
}

/** Totals per country and per day for the last `days` UTC days (today included). */
export async function trafficReport(days: number, now = new Date()): Promise<TrafficReport> {
  await flushTraffic()
  const to = utcDay(now)
  const from = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000))
  const rows = await (await db())
    .select({ day: t.trafficDaily.day, country: t.trafficDaily.country, views: t.trafficDaily.views, visitors: t.trafficDaily.visitors })
    .from(t.trafficDaily)
    .where(and(gte(t.trafficDaily.day, from), lte(t.trafficDaily.day, to)))

  const byCountry = new Map<string, TrafficCountry>()
  const byDay = new Map<string, { views: number; visitors: number }>()
  for (const r of rows) {
    const c = byCountry.get(r.country) ?? { country: r.country, views: 0, visitors: 0 }
    c.views += r.views
    c.visitors += r.visitors
    byCountry.set(r.country, c)
    const d = byDay.get(r.day) ?? { views: 0, visitors: 0 }
    d.views += r.views
    d.visitors += r.visitors
    byDay.set(r.day, d)
  }
  const daily: TrafficReport["daily"] = []
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(now.getTime() - i * 86_400_000))
    daily.push({ day, ...(byDay.get(day) ?? { views: 0, visitors: 0 }) })
  }
  const countries = [...byCountry.values()].sort((a, b) => b.views - a.views || a.country.localeCompare(b.country))
  const views = countries.reduce((n, c) => n + c.views, 0)
  const visitors = countries.reduce((n, c) => n + c.visitors, 0)
  return { days, from, to, totals: { views, visitors, countries: countries.filter((c) => c.country !== UNKNOWN_COUNTRY).length }, countries, daily }
}
