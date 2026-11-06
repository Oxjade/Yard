import "server-only"
import { sql } from "drizzle-orm"
import { db } from "../db"
import { abuseEvents, rateLimitBuckets } from "../db/schema"
import { yard } from "../state"

/**
 * Rate limits (§5.1). Per-minute windows are an in-memory sliding window (timestamps per key)
 * with an LRU cap of 50,000 keys and a sweep every 60 s, so rotating keys can't grow it without
 * bound. Daily caps are durable rows in rate_limit_buckets, joined to the caller's transaction.
 */
type Limiter = { windows: Map<string, { stamps: number[]; windowMs: number }>; abuseLogged: Map<string, number>; sweep?: NodeJS.Timeout }

const MAX_KEYS = 50_000

function limiter(): Limiter {
  const l = (yard.limiter ??= { windows: new Map(), abuseLogged: new Map() }) as Limiter
  if (!l.sweep) {
    l.sweep = setInterval(() => {
      const now = Date.now()
      for (const [k, w] of l.windows) if (!w.stamps.length || now - w.stamps[w.stamps.length - 1] > w.windowMs) l.windows.delete(k)
      for (const [k, t] of l.abuseLogged) if (now - t > 60_000) l.abuseLogged.delete(k)
    }, 60_000)
    l.sweep.unref()
  }
  return l
}

export type RateResult = { ok: true } | { ok: false; retryAfter: number }

/** One hit against a sliding window. `key` should already name the action and the actor. */
export function hit(key: string, limit: number, windowSec: number): RateResult {
  const l = limiter()
  const now = Date.now()
  const windowMs = windowSec * 1000
  let w = l.windows.get(key)
  if (w) l.windows.delete(key) // re-insert below: Map order is the LRU order
  else w = { stamps: [], windowMs }
  w.windowMs = Math.max(w.windowMs, windowMs)
  while (w.stamps.length && now - w.stamps[0] >= windowMs) w.stamps.shift()
  let result: RateResult
  if (w.stamps.length >= limit) result = { ok: false, retryAfter: Math.max(1, Math.ceil((w.stamps[0] + windowMs - now) / 1000)) }
  else {
    w.stamps.push(now)
    result = { ok: true }
  }
  l.windows.set(key, w)
  while (l.windows.size > MAX_KEYS) l.windows.delete(l.windows.keys().next().value as string)
  return result
}

/** Durable daily cap: `count = count + 1 … returning count` (survives restarts). */
export async function dailyHit(key: string, limit: number): Promise<RateResult> {
  const d = await db()
  const now = new Date()
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const bucket = `${key}:${now.toISOString().slice(0, 10)}`
  const [row] = await d
    .insert(rateLimitBuckets)
    .values({ key: bucket, count: 1, expiresAt: new Date(tomorrow.getTime() + 86_400_000) })
    .onConflictDoUpdate({ target: rateLimitBuckets.key, set: { count: sql`${rateLimitBuckets.count} + 1` } })
    .returning({ count: rateLimitBuckets.count })
  if (row.count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000)) }
  return { ok: true }
}

export type AbuseActor = { kind: "shopper" | "brand" | "anon" | "admin" | "system"; id: string | null; ipHash?: string | null }

/** Writes an abuse_events row, at most one per key per minute so abuse can't flood the table. */
export async function recordAbuse(key: string, actor: AbuseActor, action: string, rule: string, detail: Record<string, unknown> = {}) {
  const l = limiter()
  const last = l.abuseLogged.get(key)
  if (last && Date.now() - last < 60_000) return
  l.abuseLogged.set(key, Date.now())
  const d = await db()
  await d.insert(abuseEvents).values({ actorKind: actor.kind, actorId: actor.id, ipHash: actor.ipHash ?? null, action, rule, detail })
}

/** Test hook: forget every in-memory window (dev only; used by the selftest). */
export function resetWindows(prefix: string) {
  const l = limiter()
  for (const k of [...l.windows.keys()]) if (k.startsWith(prefix)) l.windows.delete(k)
}
