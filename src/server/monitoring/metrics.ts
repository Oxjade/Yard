import "server-only"
import { statfs } from "node:fs/promises"
import os from "node:os"
import { dbHealthCached } from "../db"

/**
 * Live request metrics for the admin Control Center, in memory since the server last started.
 * route() records every API request; the snapshot is what /api/admin/monitoring returns. State
 * lives on globalThis so dev HMR and duplicated module copies share one collector.
 */

const MINUTES = 60
const SAMPLES_PER_MINUTE = 200
const MAX_ROUTES = 300
const MAX_ERRORS = 30

type Bucket = { minute: number; requests: number; c4xx: number; c5xx: number; totalMs: number; samples: number[] }
type RouteStat = { key: string; count: number; totalMs: number; samples: number[]; errors: number; last: number }
export type ServerError = { at: string; method: string; path: string; status: number; requestId: string }

type State = { startedAt: number; buckets: Bucket[]; routes: Map<string, RouteStat>; errors: ServerError[] }

const g = globalThis as typeof globalThis & { __yardMetrics?: State }
function state(): State {
  return (g.__yardMetrics ??= { startedAt: Date.now(), buckets: [], routes: new Map(), errors: [] })
}

const ID_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|[a-z]{2,6}_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{20,})$/i

/** /api/brands/brd_12/products/42 → /api/brands/:id/products/:id */
export function normalisePath(path: string) {
  const clean = path.split("?")[0]!.slice(0, 200)
  return clean
    .split("/")
    .map((s) => (s && (ID_SEGMENT.test(s) || (/\d/.test(s) && s.length >= 8)) ? ":id" : s))
    .join("/")
}

function pushSample(arr: number[], ms: number, cap: number) {
  if (arr.length < cap) arr.push(ms)
  else arr[Math.floor(Math.random() * cap)] = ms // reservoir-ish: keeps a bounded, roughly uniform sample
}

/** Records one finished request. Cheap and never throws. */
export function record(method: string, path: string, status: number, ms: number, requestId = "") {
  try {
    const s = state()
    const now = Date.now()
    const minute = Math.floor(now / 60_000)
    let b = s.buckets[s.buckets.length - 1]
    if (!b || b.minute !== minute) {
      b = { minute, requests: 0, c4xx: 0, c5xx: 0, totalMs: 0, samples: [] }
      s.buckets.push(b)
      while (s.buckets.length && s.buckets[0]!.minute <= minute - MINUTES) s.buckets.shift()
    }
    b.requests++
    if (status >= 500) b.c5xx++
    else if (status >= 400) b.c4xx++
    b.totalMs += ms
    pushSample(b.samples, ms, SAMPLES_PER_MINUTE)

    const p = normalisePath(path)
    const key = `${method.toUpperCase()} ${p}`
    let r = s.routes.get(key)
    if (!r) {
      if (s.routes.size >= MAX_ROUTES) {
        let oldest: RouteStat | undefined
        for (const v of s.routes.values()) if (!oldest || v.last < oldest.last) oldest = v
        if (oldest) s.routes.delete(oldest.key)
      }
      r = { key, count: 0, totalMs: 0, samples: [], errors: 0, last: now }
      s.routes.set(key, r)
    }
    r.count++
    r.totalMs += ms
    r.last = now
    if (status >= 500) r.errors++
    pushSample(r.samples, ms, 100)

    if (status >= 500) {
      s.errors.push({ at: new Date(now).toISOString(), method: method.toUpperCase(), path: p, status, requestId })
      if (s.errors.length > MAX_ERRORS) s.errors.splice(0, s.errors.length - MAX_ERRORS)
    }
  } catch {
    // Monitoring must never break a request.
  }
}

function percentile(values: number[], q: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!)
}

async function disk() {
  try {
    const dir = process.env.YARD_DATA_DIR?.trim() || process.cwd()
    const st = await statfs(dir)
    const total = st.blocks * st.bsize
    const free = st.bavail * st.bsize
    return { path: dir, total, free, used: total - free }
  } catch {
    return null
  }
}

export type MonitoringSnapshot = Awaited<ReturnType<typeof snapshot>>

export async function snapshot() {
  const s = state()
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const byMinute = new Map(s.buckets.map((b) => [b.minute, b]))
  const series = Array.from({ length: MINUTES }, (_, i) => {
    const m = minute - (MINUTES - 1 - i)
    const b = byMinute.get(m)
    return { at: new Date(m * 60_000).toISOString(), requests: b?.requests ?? 0, errors: b?.c5xx ?? 0, avgMs: b && b.requests ? Math.round(b.totalMs / b.requests) : 0 }
  })
  const within = (mins: number) => s.buckets.filter((b) => b.minute > minute - mins)
  const sum = (bs: Bucket[]) => bs.reduce((a, b) => ({ requests: a.requests + b.requests, c4xx: a.c4xx + b.c4xx, c5xx: a.c5xx + b.c5xx }), { requests: 0, c4xx: 0, c5xx: 0 })
  const last5 = sum(within(5))
  const last15b = within(15)
  const last15 = sum(last15b)
  const last60 = sum(within(60))
  const samples15 = last15b.flatMap((b) => b.samples)
  const current = byMinute.get(minute)
  const previous = byMinute.get(minute - 1)

  const slowest = [...s.routes.values()]
    .map((r) => ({ route: r.key, count: r.count, errors: r.errors, avgMs: Math.round(r.totalMs / r.count), p95Ms: percentile(r.samples, 0.95) ?? 0 }))
    .sort((a, b) => b.p95Ms - a.p95Ms || b.avgMs - a.avgMs)
    .slice(0, 8)

  const mem = process.memoryUsage()
  const [db, diskUsage] = await Promise.all([
    (async () => {
      const t = performance.now()
      try {
        const h = await dbHealthCached()
        return { ...h, ms: Math.round(performance.now() - t) }
      } catch {
        return { kind: null, db: "down" as const, migrations: null, ms: Math.round(performance.now() - t) }
      }
    })(),
    disk(),
  ])

  return {
    now: new Date(now).toISOString(),
    startedAt: new Date(s.startedAt).toISOString(),
    uptimeSec: Math.round(process.uptime()),
    collectingSec: Math.round((now - s.startedAt) / 1000),
    process: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    os: { loadavg: os.loadavg(), cpus: os.cpus().length, totalMem: os.totalmem(), freeMem: os.freemem() },
    disk: diskUsage,
    db,
    requestsPerMin: series,
    // The current minute is partial; "now" is the last full minute when there is one.
    requestsNow: previous?.requests ?? current?.requests ?? 0,
    totals: { last5, last15, last60 },
    errorRate15m: last15.requests ? last15.c5xx / last15.requests : 0,
    latency15m: { p50: percentile(samples15, 0.5), p95: percentile(samples15, 0.95) },
    slowest,
    recentErrors: [...s.errors].reverse(),
  }
}
