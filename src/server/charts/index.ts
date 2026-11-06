import "server-only"
import { and, eq, gte, inArray } from "drizzle-orm"
import { brandById } from "@/lib/data/brands"
import { kindToSlug } from "@/lib/api/contracts/charts"
import { afterCommit, db, t } from "../db"
import { log } from "../log"
import { notify } from "../notify"
import { refreshFlags } from "./antifraud"
import { addDays, dayStart, dropAnchor, todayUtc } from "./baseline"
import { activeKeys, computeFinals, datesNeeded, loadPrior, PERIODS, writeSnapshots, type SnapshotWrite } from "./editions"
import { loadUniverse, type Period } from "./metrics"
import { chartsState, dropCaches } from "./public"
import { cityName } from "./scope"

/**
 * Charts contract (cluster C, §1.8, §6.3). Everything uses db(), so a caller's transaction carries
 * through (§1.3); nothing here does network or file I/O.
 */
export const IMPL: string = "C-2026-11-06"

export { getBoard, getScopes, getBrandBest, TTL_MS } from "./public"
export { refreshFlags, reincludeFlagEvents } from "./antifraud"

const DAY = 86_400_000

/** Which final editions the backfill and the nightly close keep, per period (§6.3 "Backfill"). */
export function finalPlan(today: string): Record<Period, string[]> {
  const last8 = Array.from({ length: 8 }, (_, i) => addDays(today, -(i + 1)))
  return { daily: last8, weekly: [...last8, addDays(today, -14)], monthly: [...last8, addDays(today, -30)] }
}

export type BackfillResult = { snapshots: number; entries: number; ms: number; dates: number }

/**
 * Computes and writes final editions. `missingOnly` skips the dates that already have finals
 * (the nightly close and the catch-up after a server was off at midnight); the seed passes false.
 * The whole compute reads in JS from one loaded universe, then writes in one short transaction.
 */
export async function backfillFinals(opts: { now?: number; missingOnly: boolean; onlyDates?: string[] }): Promise<{ result: BackfillResult; writes: SnapshotWrite[] }> {
  const started = Date.now()
  const now = opts.now ?? Date.now()
  const today = todayUtc(now)
  const plan = finalPlan(today)
  if (opts.onlyDates) for (const p of PERIODS) plan[p] = plan[p].filter((x) => opts.onlyDates!.includes(x))
  if (opts.missingOnly) {
    const d = await db()
    const all = [...new Set(Object.values(plan).flat())]
    const have = await d
      .selectDistinct({ period: t.chartSnapshots.period, edition: t.chartSnapshots.edition })
      .from(t.chartSnapshots)
      .where(and(eq(t.chartSnapshots.status, "final"), eq(t.chartSnapshots.chart, "top"), eq(t.chartSnapshots.scope, "global"), inArray(t.chartSnapshots.edition, all)))
    const done = new Set(have.map((h) => `${h.period}:${h.edition}`))
    for (const p of PERIODS) plan[p] = plan[p].filter((x) => !done.has(`${p}:${x}`))
  }
  const dates = [...new Set(Object.values(plan).flat())].sort()
  if (!dates.length) return { result: { snapshots: 0, entries: 0, ms: Date.now() - started, dates: 0 }, writes: [] }

  // Scopes people used in the last 7 days close too, whatever their cohort today.
  const d = await db()
  const used = await d.selectDistinct({ scope: t.chartSnapshots.scope }).from(t.chartSnapshots).where(gte(t.chartSnapshots.edition, addDays(today, -7)))
  const u = await loadUniverse(addDays(dates[0], -59), dates[dates.length - 1], { now, anchor: dropAnchor(now) })
  const keysFor = (edition: string) => activeKeys(u, edition, used.map((x) => x.scope))
  const allKeys = [...new Map(dates.flatMap(keysFor).map((k) => [`${k.chart}:${k.period}:${k.scope}`, k])).values()]
  const priorDates = [...new Set(dates.flatMap((x) => datesNeeded(x, PERIODS)))].filter((x) => !dates.includes(x))
  const seed = await loadPrior(allKeys, priorDates)
  const writes = computeFinals(u, plan, keysFor, seed, new Date(now))
  await writeSnapshots(writes)
  const entries = writes.reduce((s, w) => s + w.entries.length, 0)
  afterCommit(() => dropCaches())
  return { result: { snapshots: writes.length, entries, ms: Date.now() - started, dates: dates.length }, writes }
}

const notifiable = new Set(["top", "trending", "emerging", "city"])
const boardWord: Record<string, string> = { top: "Top brands", trending: "Trending", emerging: "Emerging" }

/**
 * `chart_movement` (§6.3): at edition close, a brand that entered the weekly top 10 of Top
 * brands, Trending, Emerging or its City board is told, with the sample line while the baseline
 * is on. Keyed chart:<board>:<scope>:<edition>, so a re-run never notifies twice.
 */
async function notifyMovement(writes: SnapshotWrite[], edition: string) {
  let sent = 0
  for (const w of writes) {
    if (w.edition !== edition || w.key.period !== "weekly" || !notifiable.has(w.key.chart)) continue
    const isCity = w.key.chart === "city"
    if (!isCity && w.key.scope !== "global") continue
    if (isCity && w.key.scope.includes("|")) continue
    for (const e of w.entries) {
      if (e.rank > 10 || (e.prevRank !== null && e.prevRank <= 10)) continue
      const brand = brandById.get(e.brandId)
      if (!brand) continue
      const citySlug = w.key.scope.replace(/^city:/, "")
      await notify(
        { kind: "brand", id: e.brandId },
        {
          key: `chart:${w.key.chart}:${w.key.scope}:${edition}`,
          template: "chart.movement",
          vars: { brand: brand.name, rank: e.rank, board: isCity ? `the ${cityName(citySlug)} chart` : boardWord[w.key.chart], sample: 1 },
          href: isCity ? `/charts?chart=city&period=weekly&city=${citySlug}` : `/charts?chart=${kindToSlug(w.key.chart)}&period=weekly`,
        },
      )
      sent++
    }
  }
  return sent
}

/**
 * Closes the day's editions at 00:00 UTC (the scheduler), for every period and every scope with a
 * cohort or used in the last 7 days. It also closes any day of the last 8 a stopped server missed.
 */
export async function closeEditions(now = Date.now(), opts: { reclose?: boolean } = {}): Promise<BackfillResult & { notified: number }> {
  await refreshFlags(now)
  // `reclose` (development only, POST /api/charts/close?reclose=1) recomputes yesterday's finals even
  // though they exist, so the close and its notices can be checked without waiting for midnight.
  const { result, writes } = opts.reclose ? await backfillFinals({ now, missingOnly: false, onlyDates: [addDays(todayUtc(now), -1)] }) : await backfillFinals({ now, missingOnly: true })
  const notified = await notifyMovement(writes, addDays(todayUtc(now), -1))
  if (result.snapshots || opts.reclose) log.info(`[yard] charts: closed ${result.snapshots} editions over ${result.dates} ${result.dates === 1 ? "day" : "days"} in ${result.ms} ms; ${notified} movement ${notified === 1 ? "notice" : "notices"}`)
  return { ...result, notified }
}

/**
 * The first board read of a day makes sure yesterday (and any day a stopped server missed) is
 * closed, so movement always compares with a real final edition. Once per process per day.
 */
export function ensureClosed(now = Date.now()): Promise<unknown> {
  const s = chartsState() as ReturnType<typeof chartsState> & { closedFor?: { day: string; run: Promise<unknown> } }
  const day = todayUtc(now)
  if (s.closedFor?.day === day) return s.closedFor.run
  const run = closeEditions(now).catch((e) => log.error("[yard] charts: catch-up close failed", e))
  s.closedFor = { day, run }
  return run
}

/**
 * Drops cached boards (all, or those a brand appears on) after a status, flag or freeze change.
 * Admin decisions call it inside their transaction, so it waits for the commit.
 */
export function invalidate(brandId?: string): void {
  void brandId
  afterCommit(() => dropCaches())
}

/** Admin "Recompute now" (M): re-runs the detectors and drops every cached board. */
export async function recompute(now = Date.now()) {
  const flags = await refreshFlags(now)
  afterCommit(() => dropCaches())
  return flags
}

/** Milliseconds until the next 00:00 UTC (for the hand-off and the scheduler's log). */
export const msUntilClose = (now = Date.now()) => dayStart(todayUtc(now)) + DAY - now

/** Scheduler jobs, resolved afresh on every tick (§1.3 Schedulers). */
export const jobs = { closeEditions: () => closeEditions().then(() => undefined) }
