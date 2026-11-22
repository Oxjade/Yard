import assert from "node:assert/strict"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { and, eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { users } from "../db/schema/people"
import { metricsMinutes } from "../db/schema/metrics"
import { businessCounts } from "./activity"
import { ackFlush, addEvent, addRequest, areaOf, bucketIndex, createState, emptyCell, HIST_BOUNDS, percentile, rollup, takeBatch, type MetricRow } from "./minutes"
import { bucketStarts, businessSeries, dailyRequests, dailyTotals, requestBuckets, requestSeries, utcDay } from "./series"
import { flush, readRows, recordDeploy, listDeploys, rollupAndPrune, writeRows, type Db } from "./store"

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const T0 = Date.parse("2026-11-20T10:00:00Z")

const row = (at: number, area: MetricRow["area"], over: Partial<MetricRow> = {}): MetricRow => ({ at: new Date(at), area, ...emptyCell(), events: {}, ...over })

describe("histogram", () => {
  it("puts each latency in the first bucket whose bound holds it", () => {
    assert.equal(bucketIndex(0), 0)
    assert.equal(bucketIndex(5), 0)
    assert.equal(bucketIndex(5.1), 1)
    assert.equal(bucketIndex(100), 4)
    assert.equal(bucketIndex(10_000), HIST_BOUNDS.length - 1)
    assert.equal(bucketIndex(60_000), HIST_BOUNDS.length)
  })

  it("reads percentiles by interpolating inside the bucket", () => {
    const st = createState("t")
    // 100 requests: 50 at 8 ms (bucket 5-10), 45 at 80 ms (50-100), 5 at 400 ms (250-500).
    for (let i = 0; i < 50; i++) addRequest(st, T0, "public", 200, 8)
    for (let i = 0; i < 45; i++) addRequest(st, T0, "public", 200, 80)
    for (let i = 0; i < 5; i++) addRequest(st, T0, "public", 200, 400)
    const hist = takeBatch(st).rows[0]!.hist
    assert.equal(percentile(hist, 0.5), 10) // the 50th request is the last of the 5-10 ms bucket
    assert.equal(percentile(hist, 0.95), 100) // the 95th is the last of 50-100 ms
    assert.equal(percentile(hist, 0.99), 450) // 4th of 5 in 250-500 ms → 250 + 4/5 × 250
    assert.equal(percentile(new Array(12).fill(0), 0.5), null)
    // Everything over 10 s reads as 10 s, never more than was measured as a bound.
    const slow = new Array(12).fill(0)
    slow[11] = 3
    assert.equal(percentile(slow, 0.95), 10_000)
  })

  it("splits requests by area and counts 4xx and 5xx apart", () => {
    assert.equal(areaOf("/api/admin/metrics"), "admin")
    assert.equal(areaOf("/api/orders/admin/x"), "admin")
    assert.equal(areaOf("/api/studio/catalog"), "studio")
    assert.equal(areaOf("/api/auth/sign-in"), "api")
    assert.equal(areaOf("/api/session"), "api")
    assert.equal(areaOf("/api/search"), "public")
    assert.equal(areaOf("/api/sessionx"), "public")
    const st = createState("t")
    addRequest(st, T0, "admin", 200, 10)
    addRequest(st, T0, "admin", 404, 10)
    addRequest(st, T0, "admin", 503, 10)
    addRequest(st, T0, "studio", 201, 30)
    const rows = takeBatch(st).rows
    const admin = rows.find((r) => r.area === "admin")!
    assert.deepEqual([admin.requests, admin.c4xx, admin.c5xx, admin.totalMs, admin.maxMs], [3, 1, 1, 30, 10])
    assert.equal(rows.find((r) => r.area === "studio")!.requests, 1)
  })
})

describe("rollup", () => {
  it("sums counters and histograms, keeps the max, per hour and per UTC day", () => {
    const h = emptyCell().hist
    const a = row(T0 + 1 * MIN, "public", { requests: 3, c4xx: 1, totalMs: 30, maxMs: 20, hist: h.map((_, i) => (i === 1 ? 3 : 0)) })
    const b = row(T0 + 59 * MIN, "public", { requests: 2, c5xx: 2, totalMs: 900, maxMs: 700, hist: h.map((_, i) => (i === 7 ? 2 : 0)) })
    const c = row(T0 + 61 * MIN, "public", { requests: 1, totalMs: 5, maxMs: 5, hist: h.map((_, i) => (i === 0 ? 1 : 0)) })
    const e1 = row(T0 + 2 * MIN, "events", { events: { "auth.signin_fail.shopper": 2 } })
    const e2 = row(T0 + 70 * MIN, "events", { events: { "auth.signin_fail.shopper": 1, search: 4 } })
    const hours = rollup([a, b, c, e1, e2], "h")
    assert.equal(hours.length, 4)
    const first = hours.find((r) => r.area === "public" && r.at.getTime() === T0)!
    assert.deepEqual([first.requests, first.c4xx, first.c5xx, first.totalMs, first.maxMs], [5, 1, 2, 930, 700])
    assert.equal(first.hist[1], 3)
    assert.equal(first.hist[7], 2)
    const days = rollup(hours, "d")
    const pub = days.find((r) => r.area === "public")!
    assert.equal(pub.at.toISOString(), "2026-11-20T00:00:00.000Z")
    assert.equal(pub.requests, 6)
    assert.equal(pub.hist.reduce((s, n) => s + n, 0), 6)
    assert.deepEqual(days.find((r) => r.area === "events")!.events, { "auth.signin_fail.shopper": 3, search: 4 })
    // Rolling up twice changes nothing: rollup(rollup(x)) == rollup(x).
    assert.deepEqual(rollup(days, "d"), days)
  })
})

describe("series", () => {
  it("aligns buckets to UTC and ends on the bucket holding now", () => {
    const now = Date.parse("2026-11-22T13:47:10Z")
    const day = bucketStarts("30d", now)
    assert.equal(day.length, 30)
    assert.equal(new Date(day[29]!).toISOString(), "2026-11-22T00:00:00.000Z")
    const q = bucketStarts("24h", now)
    assert.equal(q.length, 96)
    assert.equal(new Date(q[95]!).toISOString(), "2026-11-22T13:45:00.000Z")
    assert.equal(bucketStarts("1h", now).length, 60)
    assert.equal(bucketStarts("7d", now).length, 168)
    assert.equal(bucketStarts("1y", now).length, 365)
  })

  it("puts minute, hour and day rows into the range's buckets without double counting", () => {
    const now = Date.parse("2026-11-22T12:00:30Z")
    const rows = [row(now - 5 * MIN, "public", { requests: 2 }), row(now - 5 * MIN, "admin", { requests: 1, c5xx: 1 }), row(Date.parse("2026-11-19T07:00:00Z"), "public", { requests: 10 }), row(now - 400 * DAY, "public", { requests: 99 })]
    const pts = requestBuckets(rows, "7d", now)
    const s = requestSeries(pts, "requests")
    assert.equal(s.summary.total, 13)
    assert.equal(s.points.find((p) => p.primary === 10)!.at, Date.parse("2026-11-19T07:00:00Z"))
    assert.equal(requestSeries(pts, "errors").summary.total, 1)
  })

  it("picks the currency with the most revenue and keeps orders and paid apart", () => {
    const now = Date.parse("2026-11-22T12:00:00Z")
    const d = Date.parse("2026-11-21T00:00:00Z")
    const counts = [
      { k: "orders", cur: null, b: d, n: 4, v: 0 },
      { k: "paid", cur: null, b: d, n: 3, v: 0 },
      { k: "revenue", cur: "NGN", b: d, n: 2, v: 900_000 },
      { k: "revenue", cur: "USD", b: d, n: 1, v: 5_000 },
    ]
    const o = businessSeries(counts, "30d", now, "orders")
    assert.equal(o.summary.total, 4)
    assert.equal(o.points.find((p) => p.at === d)!.secondary, 3)
    const r = businessSeries(counts, "30d", now, "revenue")
    assert.equal(r.currency, "NGN")
    assert.deepEqual(r.currencies, ["NGN", "USD"])
    assert.equal(businessSeries(counts, "30d", now, "revenue", "USD").summary.total, 5_000)
  })
})

describe("on a database", () => {
  let pg: PGlite
  let d: Db

  before(async () => {
    pg = new PGlite()
    const db = drizzle(pg)
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") })
    d = db as unknown as Db
  })
  after(async () => {
    await pg.close()
  })

  const sumRequests = async () => Number(((await d.execute(sql`select coalesce(sum(requests), 0)::int as n from metrics_minutes`)) as unknown as { rows: { n: number }[] }).rows[0]!.n)

  it("flush is idempotent: a retry or a second flush of the same minute never double counts", async () => {
    await d.delete(metricsMinutes)
    const st = createState("boot-a")
    for (let i = 0; i < 5; i++) addRequest(st, T0 + 10_000, "public", 200, 20)
    addEvent(st, T0 + 10_000, "search", 2)
    assert.equal(await flush(d, st, T0 + 30_000), 2)
    // The same minute again, unchanged: nothing to write.
    assert.equal(await flush(d, st, T0 + 40_000), 0)
    // A "retry" of a batch that already committed (the ack was lost): written again, same total.
    const replay = takeBatch(createState("x"))
    assert.equal(replay.rows.length, 0)
    const again = { rows: [row(T0, "public", { requests: 5, totalMs: 100, maxMs: 20, hist: emptyCell().hist.map((_, i) => (i === 2 ? 5 : 0)) })], versions: new Map() }
    await writeRows(d, "m", "boot-a", again.rows)
    assert.equal(await sumRequests(), 5)
    // More requests in the same minute: the row is replaced with the new running total.
    for (let i = 0; i < 3; i++) addRequest(st, T0 + 50_000, "public", 500, 20)
    await flush(d, st, T0 + 55_000)
    assert.equal(await sumRequests(), 8)
    // The minute ends and is forgotten once flushed; a new minute is a new row.
    await flush(d, st, T0 + MIN + 1)
    assert.equal(st.minutes.size, 0)
    addRequest(st, T0 + MIN + 5_000, "public", 200, 20)
    await flush(d, st, T0 + MIN + 6_000)
    assert.equal(await sumRequests(), 9)
    const ev = (await readRows(d, new Date(T0))).find((r) => r.area === "events")!
    assert.deepEqual(ev.events, { search: 2 })
  })

  it("a failed write acknowledges nothing, so the next flush sends the same totals", async () => {
    await d.delete(metricsMinutes)
    const st = createState("boot-b")
    for (let i = 0; i < 4; i++) addRequest(st, T0 + 5_000, "studio", 200, 15)
    const broken = { insert: () => ({ values: () => ({ onConflictDoUpdate: async () => Promise.reject(new Error("down")) }) }) } as unknown as Db
    await assert.rejects(flush(broken, st, T0 + 2 * MIN))
    assert.equal(st.minutes.size, 1)
    await flush(d, st, T0 + 2 * MIN)
    assert.equal(st.minutes.size, 0)
    assert.equal(await sumRequests(), 4)
  })

  it("requests that land while a flush is in flight are kept for the next one", async () => {
    const st = createState("boot-c")
    addRequest(st, T0 + 1_000, "api", 200, 1)
    const batch = takeBatch(st)
    addRequest(st, T0 + 2_000, "api", 200, 1)
    ackFlush(st, batch, T0 + 5 * MIN)
    assert.equal(st.minutes.size, 1, "the minute changed after the batch was taken, so it stays")
    assert.equal(takeBatch(st).rows[0]!.requests, 2)
  })

  it("two processes' rows for one minute add up (one row per boot id)", async () => {
    await d.delete(metricsMinutes)
    const a = createState("boot-1")
    const b = createState("boot-2")
    addRequest(a, T0, "public", 200, 10)
    addRequest(b, T0, "public", 200, 10)
    addRequest(b, T0, "public", 200, 10)
    await flush(d, a, T0 + 1_000)
    await flush(d, b, T0 + 1_000)
    assert.equal(await sumRequests(), 3)
  })

  it("rolls minutes into hours after 48 h and hours into days after 30 days, once", async () => {
    await d.delete(metricsMinutes)
    const now = Date.parse("2026-11-22T03:00:00Z")
    const old = Date.parse("2026-11-19T10:00:00Z") // > 48 h ago
    const recent = now - 2 * HOUR
    await writeRows(d, "m", "boot-x", [row(old + MIN, "public", { requests: 2 }), row(old + 30 * MIN, "public", { requests: 3 }), row(recent, "public", { requests: 7 })])
    await writeRows(d, "m", "boot-y", [row(old + 30 * MIN, "public", { requests: 1 })])
    await writeRows(d, "h", "rollup", [row(Date.parse("2026-10-01T05:00:00Z"), "admin", { requests: 4 }), row(Date.parse("2026-10-01T06:00:00Z"), "admin", { requests: 6 })])
    await writeRows(d, "d", "rollup", [row(Date.parse("2025-09-01T00:00:00Z"), "public", { requests: 50 })])
    const first = await rollupAndPrune(d, now)
    assert.deepEqual(first, { minutes: 3, hours: 2, days: 1 })
    assert.equal(await sumRequests(), 23)
    const hour = await d.select().from(metricsMinutes).where(and(eq(metricsMinutes.grain, "h"), eq(metricsMinutes.at, new Date(old))))
    assert.equal(hour.length, 1)
    assert.equal(hour[0]!.requests, 6)
    const day = await d.select().from(metricsMinutes).where(eq(metricsMinutes.grain, "d"))
    assert.equal(day[0]!.requests, 10)
    // A second run (a retry) finds nothing left to roll and changes nothing.
    assert.deepEqual(await rollupAndPrune(d, now), { minutes: 0, hours: 0, days: 0 })
    assert.equal(await sumRequests(), 23)
    // A late minute row of an hour that was already rolled merges into the same hour row.
    await writeRows(d, "m", "boot-z", [row(old + 45 * MIN, "public", { requests: 4 })])
    await rollupAndPrune(d, now)
    const merged = await d.select().from(metricsMinutes).where(and(eq(metricsMinutes.grain, "h"), eq(metricsMinutes.at, new Date(old))))
    assert.equal(merged[0]!.requests, 10)
  })

  it("buckets by UTC day whatever the session's time zone, and the heatmap totals follow", async () => {
    await d.execute(sql`set time zone 'America/New_York'`)
    try {
      // 23:30 in New York on 1 March is 04:30 UTC on 2 March; 00:30 in Lagos (UTC+1) on 3 March is 23:30 UTC on 2 March.
      const at = ["2026-03-01T23:30:00-05:00", "2026-03-03T00:30:00+01:00", "2026-03-01T12:00:00Z"]
      await d.insert(users).values(at.map((t, i) => ({ id: `u_tz_${i}`, kind: "shopper", name: `Tz ${i}`, email: `tz${i}@example.com`, demo: false, createdAt: new Date(t) })))
      assert.deepEqual(at.map((t) => utcDay(new Date(t))), ["2026-03-02", "2026-03-02", "2026-03-01"])
      const counts = await businessCounts(d, new Date("2026-02-20T00:00:00Z"), DAY, { realUsersOnly: true, notSampleBrand: (c) => sql`${c} <> 'brd_sample'` })
      assert.deepEqual(dailyTotals(counts, ["signups"]), { "2026-03-01": 1, "2026-03-02": 2 })
      // Hourly buckets are UTC hours too.
      const hourly = await businessCounts(d, new Date("2026-02-20T00:00:00Z"), HOUR, { realUsersOnly: true })
      assert.ok(hourly.some((c) => c.k === "signups" && new Date(c.b).toISOString() === "2026-03-02T04:00:00.000Z"))
      assert.deepEqual(dailyRequests([row(Date.parse("2026-03-01T23:59:00Z"), "public", { requests: 2 }), row(Date.parse("2026-03-02T00:00:00Z"), "public", { requests: 3 })]), { "2026-03-01": 2, "2026-03-02": 3 })
    } finally {
      await d.execute(sql`set time zone 'UTC'`)
    }
  })

  it("records a deploy once per build and counts its boots", async () => {
    const info = { id: "abc123", version: "abc123", gitSha: null, buildId: "b1" }
    await recordDeploy(d, info, new Date(T0))
    await recordDeploy(d, { ...info, gitSha: "f".repeat(40) }, new Date(T0 + HOUR))
    const [x] = await listDeploys(d)
    assert.equal(x!.boots, 2)
    assert.equal(x!.firstSeenAt.getTime(), T0)
    assert.equal(x!.lastBootAt.getTime(), T0 + HOUR)
    assert.equal(x!.gitSha, "f".repeat(40))
  })
})
