/**
 * Turns stored metric rows and business counts into the Activity graph's points (pure; tested).
 * Every bucket is aligned to UTC: minutes, quarter hours, hours and UTC days. The year heatmap
 * counts UTC days too, the same day boundary as the Overview's daily charts.
 */
import { emptyCell, mergeEvents, mergeInto, percentile, type Cell, type MetricRow } from "./minutes"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const RANGES = {
  "1h": { spanMs: HOUR, stepMs: MIN },
  "24h": { spanMs: DAY, stepMs: 15 * MIN },
  "7d": { spanMs: 7 * DAY, stepMs: HOUR },
  "30d": { spanMs: 30 * DAY, stepMs: DAY },
  "1y": { spanMs: 365 * DAY, stepMs: DAY },
} as const
export type RangeKey = keyof typeof RANGES
export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[]

export const METRICS = ["requests", "errors", "latency", "orders", "revenue", "signups"] as const
export type MetricKey = (typeof METRICS)[number]

/** The bucket starts of a range ending in the bucket that holds `nowMs` (oldest first). */
export function bucketStarts(range: RangeKey, nowMs: number): number[] {
  const { spanMs, stepMs } = RANGES[range]
  const n = Math.round(spanMs / stepMs)
  const last = Math.floor(nowMs / stepMs) * stepMs
  return Array.from({ length: n }, (_, i) => last - (n - 1 - i) * stepMs)
}

export type RequestPoint = { at: number; cell: Cell; events: Record<string, number> }

/** Stored rows of any grain summed into the range's buckets. Rows outside the range are ignored. */
export function requestBuckets(rows: readonly MetricRow[], range: RangeKey, nowMs: number): RequestPoint[] {
  const starts = bucketStarts(range, nowMs)
  const { stepMs } = RANGES[range]
  const first = starts[0]!
  const byStart = new Map<number, RequestPoint>(starts.map((at) => [at, { at, cell: emptyCell(), events: {} }]))
  for (const r of rows) {
    const t = r.at.getTime()
    if (t < first) continue
    const p = byStart.get(Math.floor(t / stepMs) * stepMs)
    if (!p) continue
    if (r.area !== "events") mergeInto(p.cell, r)
    mergeEvents(p.events, r.events)
  }
  return starts.map((at) => byStart.get(at)!)
}

/** One business count: `k` the series, `cur` the currency (revenue only), `b` the bucket start in ms. */
export type BusinessCount = { k: string; cur: string | null; b: number; n: number; v: number }

export type Point = { at: number; primary: number | null; secondary?: number | null }
export type Summary = { total: number | null; peak: { at: number; value: number } | null; latest: number | null; average: number | null; p50?: number | null; p95?: number | null }

/** Request-side metrics: counts per bucket, errors (5xx with 4xx), latency (p95 with p50). */
export function requestSeries(points: RequestPoint[], metric: "requests" | "errors" | "latency"): { points: Point[]; summary: Summary } {
  const all = points.reduce((a, p) => mergeInto(a, p.cell), emptyCell())
  if (metric === "latency") {
    const out = points.map((p) => ({ at: p.at, primary: percentile(p.cell.hist, 0.95), secondary: percentile(p.cell.hist, 0.5) }))
    return { points: out, summary: { ...summarise(out.map((p) => ({ at: p.at, v: p.primary }))), total: null, average: all.requests ? Math.round(all.totalMs / all.requests) : null, p50: percentile(all.hist, 0.5), p95: percentile(all.hist, 0.95) } }
  }
  const out = points.map((p) => (metric === "requests" ? { at: p.at, primary: p.cell.requests, secondary: p.cell.c5xx } : { at: p.at, primary: p.cell.c5xx, secondary: p.cell.c4xx }))
  return { points: out, summary: summarise(out.map((p) => ({ at: p.at, v: p.primary }))) }
}

/** Business metrics per bucket: orders (with paid), revenue in one currency, sign-ups (with brand applications). */
export function businessSeries(counts: readonly BusinessCount[], range: RangeKey, nowMs: number, metric: "orders" | "revenue" | "signups", currency?: string | null) {
  const starts = bucketStarts(range, nowMs)
  const { stepMs } = RANGES[range]
  const pick = (k: string, field: "n" | "v", cur?: string | null) => {
    const m = new Map<number, number>()
    for (const c of counts) if (c.k === k && (cur === undefined || c.cur === cur)) m.set(Math.floor(c.b / stepMs) * stepMs, (m.get(Math.floor(c.b / stepMs) * stepMs) ?? 0) + Number(c[field]))
    return m
  }
  const currencies = [...new Map(counts.filter((c) => c.k === "revenue" && c.cur).map((c) => [c.cur!, 0])).keys()].sort()
  const totals = new Map<string, number>()
  for (const c of counts) if (c.k === "revenue" && c.cur) totals.set(c.cur, (totals.get(c.cur) ?? 0) + Number(c.v))
  const cur = metric === "revenue" ? (currency && currencies.includes(currency) ? currency : ([...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)) : null
  const [a, b] = metric === "orders" ? [pick("orders", "n"), pick("paid", "n")] : metric === "revenue" ? [pick("revenue", "v", cur), pick("revenue", "n", cur)] : [pick("signups", "n"), pick("applications", "n")]
  const points = starts.map((at) => ({ at, primary: a.get(at) ?? 0, secondary: b.get(at) ?? 0 }))
  return { points, summary: summarise(points.map((p) => ({ at: p.at, v: p.primary }))), currencies, currency: cur }
}

function summarise(values: { at: number; v: number | null }[]): Summary {
  const known = values.filter((x): x is { at: number; v: number } => x.v !== null)
  if (!known.length) return { total: 0, peak: null, latest: null, average: null }
  const total = known.reduce((s, x) => s + x.v, 0)
  const peak = known.reduce((m, x) => (x.v > m.v ? x : m), known[0]!)
  return { total, peak: peak.v > 0 ? { at: peak.at, value: peak.v } : null, latest: values[values.length - 1]?.v ?? null, average: total / values.length }
}

/* ── The year heatmap ─────────────────────────────────────────────────── */

/** YYYY-MM-DD of the UTC day holding `d` (the day boundary every heatmap and daily chart uses). */
export const utcDay = (d: Date | number) => new Date(d).toISOString().slice(0, 10)

/** Daily counts for the heatmap: business counts (day buckets) of the chosen kinds, summed per UTC day. */
export function dailyTotals(counts: readonly BusinessCount[], kinds: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of counts) {
    if (!kinds.includes(c.k)) continue
    const day = utcDay(c.b)
    out[day] = (out[day] ?? 0) + Number(c.n)
  }
  return out
}

/** Daily request totals from stored rows of any grain, by UTC day. */
export function dailyRequests(rows: readonly MetricRow[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    if (r.area === "events") continue
    const day = utcDay(r.at)
    out[day] = (out[day] ?? 0) + r.requests
  }
  return out
}

/** What makes up "All activity" on the heatmap. */
export const ACTIVITY_KINDS = ["orders", "signups", "applications", "products", "messages"] as const
