import "server-only"
import { existsSync, readFileSync } from "node:fs"
import { statfs } from "node:fs/promises"
import path from "node:path"
import { memo } from "../cache"
import { db } from "../db"
import { getEnv } from "../env"
import { log } from "../log"
import { notSampleBrandSql } from "../catalog/sample-guard"
import { businessCounts, mediaStorage, queueDepths, rateLimitBlocks, type Guards } from "./activity"
import { processState } from "./minutes"
import { ACTIVITY_KINDS, RANGES, businessSeries, dailyRequests, dailyTotals, requestBuckets, requestSeries, utcDay, type MetricKey, type RangeKey } from "./series"
import { flush, listDeploys, readRows, recordDeploy, rollupAndPrune, type Db } from "./store"
import { attestConfig } from "../app-attest/config"

/**
 * Admin › Health's real figures. Cost scales with time, not traffic: requests are counted in
 * memory (minutes.ts) and written once a minute; every read below is one memoised query per range
 * (request series 1 minute, business series and heatmaps 5 minutes, disk 5 minutes), so a busy
 * Control Center costs the database the same as an idle one.
 */

const MIN = 60_000
const DAY = 86_400_000

const handle = async () => (await db()) as unknown as Db

/** YARD_METRICS_FLUSH_MS (default 60 s; 1 s to 10 min), for testing a flush without waiting a minute. */
export function flushEveryMs(env: Record<string, string | undefined> = process.env) {
  const n = Number(env.YARD_METRICS_FLUSH_MS?.trim() || "")
  return Number.isFinite(n) && n >= 1000 && n <= 600_000 ? Math.round(n) : MIN
}

/** One flush of this process's minute counters. Never throws (the next flush retries the same totals). */
export async function flushMetrics() {
  try {
    return await flush(await handle(), processState())
  } catch (e) {
    log.error("[yard] metrics flush failed (retried next minute)", e)
    return 0
  }
}

/** The nightly rollup (minutes → hours after 48 h, hours → days after 30 days, days dropped after 400). */
export async function rollupMetrics() {
  const n = await rollupAndPrune(await handle())
  if (n.minutes + n.hours + n.days) log.info(`[yard] metrics rollup: ${n.minutes} minute rows, ${n.hours} hour rows rolled up; ${n.days} day rows dropped`)
  return n
}

/* ── The running build ───────────────────────────────────────────────── */

function readText(file: string) {
  try {
    return existsSync(file) ? readFileSync(file, "utf8").trim() : null
  } catch {
    return null
  }
}

/** The checkout's HEAD commit, read from .git without running git (null when there is no checkout). */
export function gitSha(root = process.cwd()): string | null {
  const dir = path.join(/*turbopackIgnore: true*/ root, ".git")
  const head = readText(path.join(/*turbopackIgnore: true*/ dir, "HEAD"))
  if (!head) return null
  if (/^[0-9a-f]{40}$/.test(head)) return head
  const ref = /^ref: (.+)$/.exec(head)?.[1]
  if (!ref) return null
  const loose = readText(path.join(/*turbopackIgnore: true*/ dir, ref))
  if (loose && /^[0-9a-f]{40}$/.test(loose)) return loose
  const packed = readText(path.join(/*turbopackIgnore: true*/ dir, "packed-refs"))
  const line = packed?.split("\n").find((l) => l.endsWith(` ${ref}`))
  return line?.slice(0, 40) ?? null
}

export function runningBuild(env: Record<string, string | undefined> = process.env) {
  const deployment = env.YARD_DEPLOYMENT_ID?.trim() || null
  const sha = gitSha()
  const buildId = readText(path.join(/*turbopackIgnore: true*/ process.cwd(), ".next", "BUILD_ID"))
  const id = deployment ?? sha ?? buildId ?? "unknown"
  const version = /^[0-9a-f]{40}$/.test(id) ? id.slice(0, 12) : id.slice(0, 64)
  return { id, version, gitSha: sha ?? (deployment && /^[0-9a-f]{7,40}$/.test(deployment) ? deployment : null), buildId }
}

const bootedAt = () => new Date(Date.now() - process.uptime() * 1000)

/** Once per server boot (src/server/schedulers.ts): the running build's deploys row. */
export async function recordBoot() {
  try {
    await recordDeploy(await handle(), runningBuild())
  } catch (e) {
    log.error("[yard] recording the running build failed", e)
  }
}

/* ── Reads for the API ──────────────────────────────────────────────── */

const guards = (): Guards => (getEnv().seedDemo ? {} : { notSampleBrand: (c) => notSampleBrandSql(c), realUsersOnly: true })

const requestRows = (range: RangeKey) => memo(`metrics:req:${range}`, MIN, async () => readRows(await handle(), new Date(Date.now() - RANGES[range].spanMs - RANGES[range].stepMs)))
const business = (range: RangeKey) => memo(`metrics:biz:${range}`, 5 * MIN, async () => businessCounts(await handle(), new Date(Date.now() - RANGES[range].spanMs - RANGES[range].stepMs), RANGES[range].stepMs, guards()))

export type MetricsResponse = Awaited<ReturnType<typeof metricSeries>>

export async function metricSeries(range: RangeKey, metric: MetricKey, currency?: string | null) {
  const now = Date.now()
  const { stepMs } = RANGES[range]
  if (metric === "requests" || metric === "errors" || metric === "latency") {
    const rows = await requestRows(range)
    const s = requestSeries(requestBuckets(rows, range, now), metric)
    return { range, metric, stepMs, now: new Date(now).toISOString(), ...s, currencies: [] as string[], currency: null as string | null, hasData: rows.some((r) => r.area !== "events" && r.requests > 0) }
  }
  const counts = await business(range)
  const s = businessSeries(counts, range, now, metric, currency)
  return { range, metric, stepMs, now: new Date(now).toISOString(), points: s.points, summary: s.summary, currencies: s.currencies, currency: s.currency, hasData: s.points.some((p) => (p.primary ?? 0) > 0 || (p.secondary ?? 0) > 0) }
}

export const HEATMAP_METRICS = ["activity", "orders", "requests"] as const
export type HeatmapMetric = (typeof HEATMAP_METRICS)[number]
/** 53 weeks of days, so the grid always has full week columns. */
const HEAT_DAYS = 53 * 7

/** Daily totals for the year heatmap, by UTC day. */
export function heatmap(metric: HeatmapMetric) {
  return memo(`metrics:heat:${metric}`, 5 * MIN, async () => {
    const now = Date.now()
    const today = utcDay(now)
    const since = new Date(Date.parse(`${today}T00:00:00Z`) - (HEAT_DAYS - 1) * DAY)
    const days = metric === "requests" ? dailyRequests(await readRows(await handle(), since)) : dailyTotals(await businessCounts(await handle(), since, DAY, guards()), metric === "orders" ? ["orders"] : ACTIVITY_KINDS)
    const values = Object.values(days)
    return { metric, timeZone: "UTC", today, from: utcDay(since), days, total: values.reduce((s, v) => s + v, 0), activeDays: values.filter((v) => v > 0).length }
  })
}

/** Disk of the data volume (fs.statfs), cached 5 minutes. */
const disk = () =>
  memo("metrics:disk", 5 * MIN, async () => {
    const dir = getEnv().dataDir
    try {
      const st = await statfs(dir)
      return { path: dir, total: st.blocks * st.bsize, free: st.bavail * st.bsize }
    } catch {
      return null
    }
  })

/** App attestation in the last 24 hours (src/server/app-attest): the mode, which platforms are on, and the verdicts. */
function appAttestCounts(ev: Record<string, number>) {
  const sum = (prefix: string) => Object.entries(ev).reduce((t, [k, v]) => (k === prefix || k.startsWith(`${prefix}.`) ? t + v : t), 0)
  const c = attestConfig(process.env)
  return {
    mode: c.mode,
    android: !!c.android,
    ios: !!c.ios,
    pass: sum("app_attest.pass"),
    fail: sum("app_attest.fail"),
    missing: sum("app_attest.missing"),
    blocked: sum("app_attest.blocked"),
    unavailable: sum("app_attest.unavailable"),
  }
}

export type OpsResponse = Awaited<ReturnType<typeof operations>>

/** Queue depth, storage, auth failures (24 h) and the deploy history. */
export function operations() {
  return memo("metrics:ops", MIN, async () => {
    const d = await handle()
    const now = new Date()
    const since = new Date(now.getTime() - DAY)
    const [queues, media, diskNow, rows, blocks, deploys] = await Promise.all([queueDepths(d, now), mediaStorage(d, now), disk(), readRows(d, new Date(Math.floor(since.getTime() / MIN) * MIN)), rateLimitBlocks(d, since), listDeploys(d, 15)])
    const ev: Record<string, number> = {}
    for (const r of rows) if (r.area === "events" && r.at >= since) for (const [k, v] of Object.entries(r.events)) ev[k] = (ev[k] ?? 0) + Number(v)
    const n = (k: string) => ev[k] ?? 0
    const live = runningBuild().id
    return {
      now: now.toISOString(),
      queues,
      storage: { ...media, disk: diskNow },
      auth: {
        signIn: { shopper: n("auth.signin_fail.shopper"), brand: n("auth.signin_fail.brand"), admin: n("auth.signin_fail.admin") },
        mfa: { admin: n("auth.mfa_fail.admin") },
        locked: { shopper: n("auth.locked.shopper"), brand: n("auth.locked.brand"), admin: n("auth.locked.admin") },
        rateLimited: { signIn: blocks.auth, all: blocks.total, proxy: n("proxy.rate_limited") },
        searches: n("search"),
      },
      appAttest: appAttestCounts(ev),
      deploys: deploys.map((x) => ({ id: x.id, version: x.version, gitSha: x.gitSha, firstSeenAt: x.firstSeenAt.toISOString(), lastBootAt: x.lastBootAt.toISOString(), boots: Number(x.boots), live: x.id === live })),
      process: { bootedAt: bootedAt().toISOString(), uptimeSec: Math.round(process.uptime()) },
    }
  })
}
