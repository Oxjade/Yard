/**
 * Live Activity push tokens (live_activity_tokens): the queries, on any drizzle Postgres handle, so
 * live-activity.test.ts runs them on an in-memory database with every migration applied. No
 * "server-only". The server-only glue (when to push) is live-activity.ts.
 */
import { randomBytes } from "node:crypto"
import { and, asc, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { liveActivityTokens } from "../db/schema/engagement"
import { orderRefs } from "../db/schema/orders"
import type { LiveState } from "./live-activity-state"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>

/** Phones per order (or push-to-start tokens per shopper) kept; the oldest beyond go. */
export const MAX_TOKENS = 5

const tokenId = () => `lat_${Date.now().toString(36)}${randomBytes(6).toString("base64url")}`

export type TokenInput = { token: string; timeZone?: string | null; appVersion?: string | null }
export type TokenRow = typeof liveActivityTokens.$inferSelect

/** Keeps the newest MAX_TOKENS rows of one (user, kind, order). */
async function trim(d: Db, userId: string, kind: "update" | "start", orderRefId: string | null) {
  const where = and(eq(liveActivityTokens.userId, userId), eq(liveActivityTokens.kind, kind), orderRefId ? eq(liveActivityTokens.orderRefId, orderRefId) : sql`${liveActivityTokens.orderRefId} is null`)
  const keep = await d.select({ id: liveActivityTokens.id }).from(liveActivityTokens).where(where).orderBy(desc(liveActivityTokens.updatedAt), desc(liveActivityTokens.id)).limit(MAX_TOKENS)
  if (keep.length < MAX_TOKENS) return
  await d.delete(liveActivityTokens).where(and(where, notInArray(liveActivityTokens.id, keep.map((k) => k.id))))
}

/**
 * Stores the push token of the activity tracking `orderRefId` on one of the shopper's phones.
 * Only the shopper's own order: returns false (the route answers 404) for anyone else's or an
 * unknown order. A token seen before moves to this shopper and order; what was last sent is kept
 * only when it is the same order.
 */
export async function registerUpdateToken(d: Db, userId: string, orderRefId: string, input: TokenInput): Promise<boolean> {
  const [own] = await d.select({ id: orderRefs.id }).from(orderRefs).where(and(eq(orderRefs.id, orderRefId), eq(orderRefs.customerId, userId))).limit(1)
  if (!own) return false
  const now = new Date()
  await d
    .insert(liveActivityTokens)
    .values({ id: tokenId(), userId, orderRefId, kind: "update", token: input.token, timeZone: input.timeZone ?? null, appVersion: input.appVersion ?? null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: liveActivityTokens.token,
      set: {
        userId,
        kind: "update",
        orderRefId,
        timeZone: input.timeZone ?? sql`${liveActivityTokens.timeZone}`,
        appVersion: input.appVersion ?? sql`${liveActivityTokens.appVersion}`,
        lastState: sql`case when ${liveActivityTokens.orderRefId} = ${orderRefId} then ${liveActivityTokens.lastState} else null end`,
        lastSentAt: sql`case when ${liveActivityTokens.orderRefId} = ${orderRefId} then ${liveActivityTokens.lastSentAt} else null end`,
        updatedAt: now,
      },
    })
  await trim(d, userId, "update", orderRefId)
  return true
}

/** Stores the phone's push-to-start token (iOS 17.2+). */
export async function registerStartToken(d: Db, userId: string, input: TokenInput) {
  const now = new Date()
  await d
    .insert(liveActivityTokens)
    .values({ id: tokenId(), userId, orderRefId: null, kind: "start", token: input.token, timeZone: input.timeZone ?? null, appVersion: input.appVersion ?? null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: liveActivityTokens.token,
      set: { userId, kind: "start", orderRefId: null, timeZone: input.timeZone ?? sql`${liveActivityTokens.timeZone}`, appVersion: input.appVersion ?? sql`${liveActivityTokens.appVersion}`, lastState: null, lastSentAt: null, updatedAt: now },
    })
  await trim(d, userId, "start", null)
}

/** Removes a token, only the caller's (and, for an update token, only on that order). Returns whether one went. */
export async function removeToken(d: Db, userId: string, token: string, scope: { orderRefId: string } | { kind: "start" }) {
  const conds = [eq(liveActivityTokens.token, token), eq(liveActivityTokens.userId, userId)]
  if ("orderRefId" in scope) conds.push(eq(liveActivityTokens.orderRefId, scope.orderRefId))
  else conds.push(eq(liveActivityTokens.kind, "start"))
  const gone = await d.delete(liveActivityTokens).where(and(...conds)).returning({ id: liveActivityTokens.id })
  return gone.length > 0
}

/** The running activities' tokens for an order. */
export async function updateTokensFor(d: Db, orderRefId: string): Promise<TokenRow[]> {
  return d.select().from(liveActivityTokens).where(and(eq(liveActivityTokens.orderRefId, orderRefId), eq(liveActivityTokens.kind, "update"))).orderBy(asc(liveActivityTokens.createdAt))
}

/** A shopper's push-to-start tokens. */
export async function startTokensFor(d: Db, userId: string): Promise<TokenRow[]> {
  return d.select().from(liveActivityTokens).where(and(eq(liveActivityTokens.userId, userId), eq(liveActivityTokens.kind, "start"))).orderBy(asc(liveActivityTokens.createdAt))
}

/** Orders with at least one running activity (the hourly refresh). */
export async function ordersWithTokens(d: Db, limit = 2000): Promise<string[]> {
  const rows = await d
    .selectDistinct({ id: liveActivityTokens.orderRefId })
    .from(liveActivityTokens)
    .where(and(eq(liveActivityTokens.kind, "update"), isNotNull(liveActivityTokens.orderRefId)))
    .limit(limit)
  return rows.map((r) => r.id).filter((x): x is string => !!x)
}

export async function markSent(d: Db, id: string, state: LiveState, at: Date) {
  await d.update(liveActivityTokens).set({ lastState: state, lastSentAt: at }).where(eq(liveActivityTokens.id, id))
}

export async function deleteTokens(d: Db, ids: string[]) {
  if (ids.length) await d.delete(liveActivityTokens).where(inArray(liveActivityTokens.id, ids))
}
