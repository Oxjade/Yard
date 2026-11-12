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
  every(4 * MIN, 5 * MIN, () => runFeatureJob("payments", "expireCheckouts"))
  every(6 * MIN, 15 * MIN, () => runFeatureJob("payments", "retryRefunds"))
  every(8 * MIN, 30 * MIN, () => runFeatureJob("payments", "reconcileTransfers"))
  every(untilUtcMidnight() + 10 * MIN, untilUtcMidnight, () => runFeatureJob("payments", "purgeStaleCarts"))
  every(13 * MIN, HOUR, () => runFeatureJob("orders", "hourly"))
  every(untilUtcMidnight() + 30 * MIN, untilUtcMidnight, async () => {
    await runFeatureJob("ledger", "releaseReserves")
    await runFeatureJob("ledger", "reconcileDaily")
  })
  every(1 * MIN, MIN, () => runFeatureJob("email", "deliver"))
  every(1 * MIN, MIN, () => runFeatureJob("drops", "tick"))
  every(19 * MIN, HOUR, () => runFeatureJob("follows", "watchPrices"))
  every(2 * MIN, 10 * MIN, () => runFeatureJob("search", "ensureIndex"))
  every(untilUtcMidnight() + 20 * MIN, untilUtcMidnight, () => runFeatureJob("search", "reindex"))
}

/** For the selftest and db-check: run one job now. */
export async function runJobNow(name: "purge" | `${string}.${string}`) {
  if (name === "purge") return purgeExpired()
  const [feature, job] = name.split(".")
  if (!features[feature]) throw new Error(`unknown job ${name}`)
  await runFeatureJob(feature, job)
  return { ran: name }
}


