/**
 * The per-minute request and event aggregator behind Admin › Health's activity graphs
 * (store.ts writes it to metrics_minutes once a minute). Pure and import-free: src/proxy.ts counts
 * its refusals with countEvent() too, and the tests drive it with their own clock. State lives on
 * globalThis so dev HMR and the proxy's separate bundle share one collector in the process.
 *
 * Cost scales with time, not traffic: a request only bumps counters of its minute in memory;
 * the database sees one multi-row upsert a minute, of at most one row per area that had traffic.
 */

/** Latency bucket upper bounds in ms; the last bucket (index HIST_BOUNDS.length) is "over 10 s". */
export const HIST_BOUNDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const
export const HIST_SIZE = HIST_BOUNDS.length + 1

export const AREAS = ["public", "studio", "admin", "api"] as const
export type Area = (typeof AREAS)[number]
export type RowArea = Area | "events"

export type Cell = { requests: number; c4xx: number; c5xx: number; totalMs: number; maxMs: number; hist: number[] }

/** One row as metrics_minutes stores it (`at` is the bucket start, UTC). */
export type MetricRow = Cell & { at: Date; area: RowArea; events: Record<string, number> }

type Minute = { areas: Map<Area, Cell>; events: Map<string, number>; version: number; flushed: number }
export type MinuteState = { minutes: Map<number, Minute>; bootId: string }

/** How many unflushed minutes are kept while the database is unreachable (then the oldest go). */
export const MAX_PENDING_MINUTES = 180

export const emptyCell = (): Cell => ({ requests: 0, c4xx: 0, c5xx: 0, totalMs: 0, maxMs: 0, hist: new Array(HIST_SIZE).fill(0) })

export function createState(bootId: string): MinuteState {
  return { minutes: new Map(), bootId }
}

const G = globalThis as typeof globalThis & { __yardMinuteMetrics?: MinuteState }

/** The process's collector. The boot id names this process's minute rows (replace-on-flush). */
export function processState(): MinuteState {
  return (G.__yardMinuteMetrics ??= createState(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`))
}

export const minuteOf = (ms: number) => Math.floor(ms / 60_000)

/** Index of the latency bucket for `ms`. */
export function bucketIndex(ms: number) {
  for (let i = 0; i < HIST_BOUNDS.length; i++) if (ms <= HIST_BOUNDS[i]!) return i
  return HIST_BOUNDS.length
}

/**
 * Route class of an API path, for the area split: Control Center (/api/admin, /api/orders/admin),
 * Studio (/api/studio), shared plumbing (sign-in, session, realtime, notifications, devices,
 * uploads, webhooks, health, dev helpers) as "api", and everything a shopper's pages call as "public".
 */
export function areaOf(path: string): Area {
  if (path.startsWith("/api/admin") || path.startsWith("/api/orders/admin")) return "admin"
  if (path.startsWith("/api/studio")) return "studio"
  if (/^\/api\/(auth|session|realtime|notifications|devices|uploads|webhooks|health|dev)(\/|$)/.test(path)) return "api"
  return "public"
}

function minute(st: MinuteState, m: number): Minute {
  let row = st.minutes.get(m)
  if (!row) {
    row = { areas: new Map(), events: new Map(), version: 0, flushed: -1 }
    st.minutes.set(m, row)
    if (st.minutes.size > MAX_PENDING_MINUTES) {
      const oldest = Math.min(...st.minutes.keys())
      st.minutes.delete(oldest)
    }
  }
  return row
}

export function addRequest(st: MinuteState, nowMs: number, area: Area, status: number, ms: number) {
  const row = minute(st, minuteOf(nowMs))
  let c = row.areas.get(area)
  if (!c) row.areas.set(area, (c = emptyCell()))
  const v = Math.max(0, Number.isFinite(ms) ? ms : 0)
  c.requests++
  if (status >= 500) c.c5xx++
  else if (status >= 400) c.c4xx++
  c.totalMs += v
  if (v > c.maxMs) c.maxMs = Math.round(v)
  c.hist[bucketIndex(v)]!++
  row.version++
}

export function addEvent(st: MinuteState, nowMs: number, name: string, n = 1) {
  const row = minute(st, minuteOf(nowMs))
  row.events.set(name, (row.events.get(name) ?? 0) + n)
  row.version++
}

/** Records one finished API request (a search answered also counts as a "search" event). Never throws. */
export function recordRequest(path: string, status: number, ms: number, nowMs = Date.now()) {
  try {
    const st = processState()
    addRequest(st, nowMs, areaOf(path), status, ms)
    if (path === "/api/search" && status < 400) addEvent(st, nowMs, "search")
  } catch {
    /* monitoring must never break a request */
  }
}

/**
 * Counts an event that isn't a request: "auth.signin_fail.shopper", "auth.mfa_fail.admin",
 * "auth.locked.brand", "search", "proxy.rate_limited". Never throws.
 */
export function countEvent(name: string, n = 1, nowMs = Date.now()) {
  try {
    addEvent(processState(), nowMs, name, n)
  } catch {
    /* never break the caller */
  }
}

export type FlushBatch = { rows: MetricRow[]; versions: Map<number, number> }

/**
 * The rows to write: every minute changed since its last successful flush, with its running
 * totals (not a delta), so writing them replaces what an earlier flush of the same minute wrote.
 * Nothing is cleared here: ackFlush() does that once the write committed.
 */
export function takeBatch(st: MinuteState): FlushBatch {
  const rows: MetricRow[] = []
  const versions = new Map<number, number>()
  for (const [m, row] of st.minutes) {
    if (row.flushed === row.version) continue
    versions.set(m, row.version)
    const at = new Date(m * 60_000)
    for (const [area, c] of row.areas) rows.push({ at, area, ...c, hist: [...c.hist], events: {} })
    if (row.events.size) rows.push({ at, area: "events", ...emptyCell(), events: Object.fromEntries(row.events) })
  }
  return { rows, versions }
}

/**
 * After a committed write: marks each minute flushed at the version written, and forgets the
 * minutes that are over (before `nowMs`'s minute) and unchanged since. A minute that took more
 * requests meanwhile stays dirty and goes out again, whole, on the next flush.
 */
export function ackFlush(st: MinuteState, batch: FlushBatch, nowMs: number) {
  const current = minuteOf(nowMs)
  for (const [m, version] of batch.versions) {
    const row = st.minutes.get(m)
    if (row) row.flushed = Math.max(row.flushed, version)
  }
  for (const [m, row] of st.minutes) if (m < current && row.version === row.flushed) st.minutes.delete(m)
}

/* ── Merging and percentiles (rollups and reads) ─────────────────────── */

export function mergeInto(into: Cell, c: Cell) {
  into.requests += c.requests
  into.c4xx += c.c4xx
  into.c5xx += c.c5xx
  into.totalMs += c.totalMs
  into.maxMs = Math.max(into.maxMs, c.maxMs)
  for (let i = 0; i < HIST_SIZE; i++) into.hist[i] = (into.hist[i] ?? 0) + (c.hist[i] ?? 0)
  return into
}

export function mergeEvents(into: Record<string, number>, e: Record<string, number>) {
  for (const [k, v] of Object.entries(e)) into[k] = (into[k] ?? 0) + Number(v)
  return into
}

/**
 * The q-quantile (0..1) of the latencies a histogram counts, interpolated linearly inside its
 * bucket. Null when it counts nothing. The open last bucket reads as its lower bound (10 s).
 */
export function percentile(hist: readonly number[], q: number): number | null {
  const total = hist.reduce((a, b) => a + (b ?? 0), 0)
  if (!total) return null
  const target = Math.max(1, Math.ceil(q * total))
  let seen = 0
  for (let i = 0; i < HIST_SIZE; i++) {
    const n = hist[i] ?? 0
    if (seen + n >= target) {
      const lo = i === 0 ? 0 : HIST_BOUNDS[i - 1]!
      if (i >= HIST_BOUNDS.length) return lo
      const hi = HIST_BOUNDS[i]!
      return Math.round(lo + ((target - seen) / n) * (hi - lo))
    }
    seen += n
  }
  return HIST_BOUNDS[HIST_BOUNDS.length - 1]!
}

/** Start of the UTC hour or day holding `d`. */
export function truncate(d: Date, grain: "m" | "h" | "d"): Date {
  const t = d.getTime()
  const span = grain === "m" ? 60_000 : grain === "h" ? 3_600_000 : 86_400_000
  return new Date(Math.floor(t / span) * span)
}

/** Rows merged into one per (bucket of `grain`, area): what the nightly rollup writes. */
export function rollup(rows: readonly MetricRow[], grain: "h" | "d"): MetricRow[] {
  const out = new Map<string, MetricRow>()
  for (const r of rows) {
    const at = truncate(r.at, grain)
    const key = `${at.getTime()}|${r.area}`
    let o = out.get(key)
    if (!o) out.set(key, (o = { at, area: r.area, ...emptyCell(), events: {} }))
    mergeInto(o, r)
    mergeEvents(o.events, r.events)
  }
  return [...out.values()].sort((a, b) => a.at.getTime() - b.at.getTime() || a.area.localeCompare(b.area))
}
