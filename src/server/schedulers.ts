import "server-only"
import { isNotNull, lt, or } from "drizzle-orm"
import { db } from "./db"
import { oauthStates, rateLimitBuckets, realtimeEvents, sessions } from "./db/schema"
import { isBuildPhase } from "./env"
import { NotImplemented } from "./http/errors"
import { log } from "./log"
import { runJob } from "./shutdown"
import { yard } from "./state"

/**
 * Scheduled jobs (§1.3). setTimeout chains started once per process (yard.schedulers), never at
 * build time. Each tick resolves its job afresh with a dynamic import, so a wave-2 cluster that
 * replaces a contract stub under HMR is picked up without restarting dev. A stub job throws
 * NotImplemented: logged once per job. A new IMPL value is logged the first time it runs.
 */
type FeatureModule = { IMPL: string; jobs: Record<string, () => Promise<unknown>> }

const HOUR = 3600_000
const MIN = 60_000

const features: Record<string, () => Promise<FeatureModule>> = {
  charts: () => import("./charts"),
  social: () => import("./social"),
  shipping: () => import("./shipping"),
  media: () => import("./media"),
  auth: () => import("./auth"),
  catalog: () => import("./catalog"),
  payments: () => import("./payments"),
  orders: () => import("./orders"),
  ledger: () => import("./ledger"),
  email: () => import("./email"),
  drops: () => import("./drops"),
  follows: () => import("./follows"),
  search: () => import("./search"),
  newsletter: () => import("./newsletter"),
}

/** F1's own hourly purge: event log > 24 h, expired sessions and OAuth states, expired buckets. */
export async function purgeExpired() {
  const d = await db()
  const now = new Date()
  const events = await d.delete(realtimeEvents).where(lt(realtimeEvents.createdAt, new Date(now.getTime() - 24 * HOUR))).returning({ seq: realtimeEvents.seq })
  const s = await d.delete(sessions).where(or(lt(sessions.idleExpiresAt, now), lt(sessions.absoluteExpiresAt, now))).returning({ id: sessions.id })
  const o = await d.delete(oauthStates).where(or(isNotNull(oauthStates.usedAt), lt(oauthStates.expiresAt, now))).returning({ id: oauthStates.id })
  const b = await d.delete(rateLimitBuckets).where(lt(rateLimitBuckets.expiresAt, now)).returning({ key: rateLimitBuckets.key })
  return { events: events.length, sessions: s.length, oauthStates: o.length, buckets: b.length }
}

async function runFeatureJob(feature: string, job: string) {
  const name = `${feature}.${job}`
  try {
    const mod = await features[feature]()
    const impls = (yard.jobImpl ??= {})
    if (impls[name] !== mod.IMPL) {
      impls[name] = mod.IMPL
      log.info(`[yard] job ${name} impl=${mod.IMPL}`)
    }
    const fn = mod.jobs[job]
    if (!fn) {
      log.once(`job-missing:${name}:${mod.IMPL}`, "warn", `[yard] job ${name} is not exported by ${feature} (impl=${mod.IMPL})`)
      return
    }
    await fn()
  } catch (e) {
    if (e instanceof NotImplemented) log.once(`job-stub:${name}`, "info", `[yard] job ${name} skipped: its cluster hasn't implemented it yet`)
    else log.error(`[yard] job ${name} failed`, e)
  }
}

/** Schedules `run` every `everyMs`, the first time after `firstMs`. */
function every(firstMs: number, everyMs: number | (() => number), run: () => Promise<unknown>) {
  const tick = async () => {
    // A draining process (SIGTERM, src/server/shutdown.ts) starts no new job and stops the chain;
    // shutdown waits for a job that is already running.
    try {
      if (!(await runJob(run))) return
    } catch (e) {
      log.error("[yard] scheduled job failed", e)
    }
    const next = typeof everyMs === "function" ? everyMs() : everyMs
    setTimeout(tick, next).unref()
  }
  setTimeout(tick, firstMs).unref()
}

const untilUtcMidnight = () => {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 1000
}

export function startSchedulers() {
  if (yard.schedulers || isBuildPhase()) return
  yard.schedulers = true
  every(5 * MIN, HOUR, async () => {
    try {
      const n = await purgeExpired()
      if (n.events + n.sessions + n.oauthStates + n.buckets) log.info(`[yard] purge: ${n.events} events, ${n.sessions} sessions, ${n.oauthStates} oauth states, ${n.buckets} buckets`)
    } catch (e) {
      log.error("[yard] purge failed", e)
    }
  })
  every(7 * MIN, HOUR, () => runFeatureJob("media", "purgeOrphans"))
  every(untilUtcMidnight(), untilUtcMidnight, () => runFeatureJob("charts", "closeEditions"))
  every(3 * MIN, 30 * MIN, async () => {
    await runFeatureJob("social", "refreshDueTokens")
    await runFeatureJob("social", "syncDue")
  })
  every(11 * MIN, HOUR, () => runFeatureJob("shipping", "checkLate"))
  every(27 * MIN, HOUR, () => runFeatureJob("shipping", "courierHourly"))
  // Backend v3. All local database work and in-process timers: no paid service is called
  // unless a live provider key (Paystack, email) is configured.
  every(17 * MIN, HOUR, async () => {
    await runFeatureJob("auth", "processErasures")
    await runFeatureJob("auth", "purgeAuthState")
  })
  every(1 * MIN, MIN, async () => {
    await runFeatureJob("catalog", "publishScheduled")
    await runFeatureJob("catalog", "sweepExpiredHolds")
  })
  // Import from website (admin): picks up a scan or import a restart interrupted (a new one is kicked at once).
  // Its own chain, so a long import never delays the scheduled publish above. One indexed query when idle.
  every(2 * MIN, MIN, () => runFeatureJob("catalog", "runImports"))
  // Watched brand websites (Admin › Import from website › Keep watching): every 15 minutes, checks the
  // sites that are due (each every YARD_IMPORTER_WATCH_HOURS, default 6) for new pieces, at most
  // YARD_IMPORTER_WATCH_PER_RUN (4) brands a run. One indexed query when nothing is due.
  every(23 * MIN, 15 * MIN, () => runFeatureJob("catalog", "watchSites"))
  // Reminder emails to brands (drafts left 12 h, unpublished founding storefronts): one bounded query per kind each run.
  every(9 * MIN, 30 * MIN, () => runFeatureJob("catalog", "nudgeBrands"))
  // Newsletter campaigns (Admin › Newsletter): starts due ones and feeds the email outbox a bounded
  // batch (YARD_NEWSLETTER_PER_MINUTE, default 100). One indexed query a minute when nothing is sending.
  every(2 * MIN, MIN, () => runFeatureJob("newsletter", "run"))
  every(4 * MIN, 5 * MIN, () => runFeatureJob("payments", "expireCheckouts"))
  every(6 * MIN, 15 * MIN, () => runFeatureJob("payments", "retryRefunds"))
  every(8 * MIN, 30 * MIN, () => runFeatureJob("payments", "reconcileTransfers"))
  every(untilUtcMidnight() + 10 * MIN, untilUtcMidnight, () => runFeatureJob("payments", "purgeStaleCarts"))
  every(13 * MIN, HOUR, () => runFeatureJob("orders", "hourly"))
  // iOS Live Activities: one boot line saying whether APNs is configured, then an hourly refresh of
  // running activities (progress, "Arriving soon", stale date). Nothing runs while it's off.
  void import("./push/live-activity").then((m) => m.logLiveActivityConfig()).catch((e) => log.error("[yard] Live Activity config check failed", e))
  every(29 * MIN, HOUR, async () => {
    const { refreshLiveActivities } = await import("./push/live-activity")
    await refreshLiveActivities()
  })
  // "Add your payout account" reminder (docs/BRAND-EMAILS.md): one indexed query a run on brands_payout_needed_ix,
  // more only for a brand that is due. Cost scales with time, not with orders.
  every(21 * MIN, HOUR, () => runFeatureJob("ledger", "payoutReminders"))
  every(untilUtcMidnight() + 30 * MIN, untilUtcMidnight, async () => {
    await runFeatureJob("ledger", "releaseReserves")
    await runFeatureJob("ledger", "reconcileDaily")
  })
  every(1 * MIN, MIN, () => runFeatureJob("email", "deliver"))
  every(1 * MIN, MIN, () => runFeatureJob("drops", "tick"))
  every(19 * MIN, HOUR, () => runFeatureJob("follows", "watchPrices"))
  every(2 * MIN, 10 * MIN, () => runFeatureJob("search", "ensureIndex"))
  every(untilUtcMidnight() + 20 * MIN, untilUtcMidnight, () => runFeatureJob("search", "reindex"))
  // IndexNow (docs/SEO-AI.md): sends the public URLs that changed, deduplicated, at most 3 requests of
  // 10,000 a run. Returns at once, with no query, while INDEXNOW_KEY is unset. The API is free.
  every(5 * MIN, 5 * MIN, async () => {
    try {
      const { flushIndexNow } = await import("./seo/indexnow")
      await flushIndexNow()
    } catch (e) {
      log.error("[yard] indexnow flush failed", e)
    }
  })
  // Admin › Health activity (src/server/monitoring): the minute's request and event counters go to
  // metrics_minutes in one upsert every YARD_METRICS_FLUSH_MS (60 s); the nightly rollup keeps the
  // table small (minutes 48 h, hours 30 days, days 400 days); the running build is recorded once.
  void import("./monitoring/service").then(({ flushEveryMs, flushMetrics, recordBoot, rollupMetrics }) => {
    const flushMs = flushEveryMs()
    ;(yard as { flushMetrics?: () => Promise<unknown> }).flushMetrics = flushMetrics
    every(flushMs, flushMs, flushMetrics)
    every(untilUtcMidnight() + 40 * MIN, untilUtcMidnight, rollupMetrics)
    setTimeout(() => void runJob(recordBoot), 5_000).unref()
  })
}

/** For the selftest and db-check: run one job now. */
export async function runJobNow(name: "purge" | `${string}.${string}`) {
  if (name === "purge") return purgeExpired()
  const [feature, job] = name.split(".")
  if (!features[feature]) throw new Error(`unknown job ${name}`)
  await runFeatureJob(feature, job)
  return { ran: name }
}


