/**
 * metrics_minutes and deploys on a database handle (Admin › Health). No server-only and no
 * getEnv here: the tests run these on an in-memory PGlite with the migrations; service.ts binds
 * them to the server's database and schedule.
 */
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { deploys, metricsMinutes } from "../db/schema/metrics"
import { ackFlush, emptyCell, rollup, takeBatch, type MetricRow, type MinuteState, type RowArea } from "./minutes"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>

const HOUR = 3_600_000
const DAY = 86_400_000

/** Retention (docs in schema/metrics.ts): minutes 48 h, hours 30 days, days 400 days. */
export const RETENTION = { minutesMs: 48 * HOUR, hoursMs: 30 * DAY, daysMs: 400 * DAY }

const toDb = (grain: "m" | "h" | "d", source: string) => (r: MetricRow) => ({
  grain,
  at: r.at,
  area: r.area,
  source,
  requests: r.requests,
  c4xx: r.c4xx,
  c5xx: r.c5xx,
  totalMs: Math.round(r.totalMs),
  maxMs: Math.round(r.maxMs),
  hist: r.hist.map((n) => Math.round(n)),
  events: r.events,
})

const fromDb = (r: typeof metricsMinutes.$inferSelect): MetricRow & { grain: string } => ({
  grain: r.grain,
  at: r.at,
  area: r.area as RowArea,
  requests: Number(r.requests),
  c4xx: Number(r.c4xx),
  c5xx: Number(r.c5xx),
  totalMs: Number(r.totalMs),
  maxMs: Number(r.maxMs),
  hist: r.hist?.length ? r.hist.map(Number) : emptyCell().hist,
  events: r.events ?? {},
})

/**
 * Writes rows, replacing any row with the same key. Minute rows carry their minute's running total
 * for this process (`source` = its boot id), so writing the same minute twice (a retry, or a later
 * flush after more requests) leaves exactly the latest total: never a double count.
 */
export async function writeRows(d: Db, grain: "m" | "h" | "d", source: string, rows: MetricRow[]) {
  if (!rows.length) return 0
  await d
    .insert(metricsMinutes)
    .values(rows.map(toDb(grain, source)))
    .onConflictDoUpdate({
      target: [metricsMinutes.grain, metricsMinutes.at, metricsMinutes.area, metricsMinutes.source],
      set: {
        requests: sql`excluded.requests`,
        c4xx: sql`excluded.c4xx`,
        c5xx: sql`excluded.c5xx`,
        totalMs: sql`excluded.total_ms`,
        maxMs: sql`excluded.max_ms`,
        hist: sql`excluded.hist`,
        events: sql`excluded.events`,
      },
    })
  return rows.length
}

/**
 * One flush of the collector: the minutes changed since their last flush, one multi-row upsert,
 * then acknowledged. A failed write acknowledges nothing, so the same totals go out next time.
 */
export async function flush(d: Db, st: MinuteState, nowMs = Date.now()) {
  const batch = takeBatch(st)
  if (batch.rows.length) await writeRows(d, "m", st.bootId, batch.rows)
  ackFlush(st, batch, nowMs)
  return batch.rows.length
}

/**
 * The nightly rollup: minute rows older than 48 h become hourly rows, hourly rows older than 30
 * days become daily rows, daily rows older than 400 days go. Each step runs in one transaction
 * (merge with any existing rollup row, write, delete the source rows), so a retry after a failure
 * starts from the same rows and nothing is counted twice. Only whole hours and days are rolled.
 */
export async function rollupAndPrune(d: Db, nowMs = Date.now()) {
  const hourCut = new Date(Math.floor((nowMs - RETENTION.minutesMs) / HOUR) * HOUR)
  const dayCut = new Date(Math.floor((nowMs - RETENTION.hoursMs) / DAY) * DAY)
  const dropCut = new Date(Math.floor((nowMs - RETENTION.daysMs) / DAY) * DAY)
  const step = async (from: "m" | "h", to: "h" | "d", cut: Date) =>
    d.transaction(async (tx) => {
      const src = (await tx.select().from(metricsMinutes).where(and(eq(metricsMinutes.grain, from), lt(metricsMinutes.at, cut)))).map(fromDb)
      if (!src.length) return 0
      const merged = rollup(src, to)
      const ats = [...new Set(merged.map((r) => r.at.getTime()))].map((t) => new Date(t))
      const existing = (await tx.select().from(metricsMinutes).where(and(eq(metricsMinutes.grain, to), eq(metricsMinutes.source, "rollup"), inArray(metricsMinutes.at, ats)))).map(fromDb)
      const rows = rollup([...existing, ...merged], to)
      await writeRows(tx as unknown as Db, to, "rollup", rows)
      await tx.delete(metricsMinutes).where(and(eq(metricsMinutes.grain, from), lt(metricsMinutes.at, cut)))
      return src.length
    })
  const minutes = await step("m", "h", hourCut)
  const hours = await step("h", "d", dayCut)
  const dropped = await d.delete(metricsMinutes).where(and(eq(metricsMinutes.grain, "d"), lt(metricsMinutes.at, dropCut))).returning({ at: metricsMinutes.at })
  return { minutes, hours, days: dropped.length }
}

/** Every stored row (any grain) whose bucket starts at or after `since`. */
export async function readRows(d: Db, since: Date) {
  return (await d.select().from(metricsMinutes).where(gte(metricsMinutes.at, since))).map(fromDb)
}

export type DeployInfo = { id: string; version: string; gitSha: string | null; buildId: string | null }

/** Once per server boot: the running build's row, first seen kept, boot time and count bumped. */
export async function recordDeploy(d: Db, info: DeployInfo, at = new Date()) {
  await d
    .insert(deploys)
    .values({ ...info, firstSeenAt: at, lastBootAt: at, boots: 1 })
    .onConflictDoUpdate({ target: deploys.id, set: { lastBootAt: at, boots: sql`${deploys.boots} + 1`, version: info.version, gitSha: sql`coalesce(excluded.git_sha, ${deploys.gitSha})`, buildId: sql`coalesce(excluded.build_id, ${deploys.buildId})` } })
}

export async function listDeploys(d: Db, limit = 20) {
  return d.select().from(deploys).orderBy(desc(deploys.firstSeenAt)).limit(limit)
}
