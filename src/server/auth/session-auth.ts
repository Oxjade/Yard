import "server-only"
import { and, eq, inArray, ne } from "drizzle-orm"
import { db } from "../db"
import { sessionAuth, AUTH_METHODS } from "../db/schema/identity"

/**
 * How each session was established (v3). No row = a demo session. Real sessions (password,
 * OAuth, magic link, invite, email verification) are not tied to the demo flags, so turning
 * YARD_DEMO_AUTH off ends only demo sessions.
 */
export type AuthMethod = (typeof AUTH_METHODS)[number]

export async function recordSessionAuth(input: { sessionId: string; userId: string; method: AuthMethod; mfa?: boolean }) {
  const d = await db()
  const now = new Date()
  await d
    .insert(sessionAuth)
    .values({ sessionId: input.sessionId, userId: input.userId, method: input.method, mfaAt: input.mfa ? now : null, reauthAt: input.method === "demo" ? null : now })
    .onConflictDoUpdate({ target: sessionAuth.sessionId, set: { method: input.method, mfaAt: input.mfa ? now : null, reauthAt: input.method === "demo" ? null : now } })
}

export async function sessionAuthOf(sessionId: string) {
  const d = await db()
  const [row] = await d.select().from(sessionAuth).where(eq(sessionAuth.sessionId, sessionId)).limit(1)
  return row ?? null
}

/** True when the session was established by a real sign-in (not demo). */
export async function isRealSession(sessionId: string) {
  const row = await sessionAuthOf(sessionId)
  return !!row && row.method !== "demo"
}

/** The subset of `sessionIds` that are real sessions. */
export async function realSessionIds(sessionIds: string[]) {
  if (!sessionIds.length) return new Set<string>()
  const d = await db()
  const rows = await d
    .select({ id: sessionAuth.sessionId })
    .from(sessionAuth)
    .where(and(inArray(sessionAuth.sessionId, sessionIds), ne(sessionAuth.method, "demo")))
  return new Set(rows.map((r) => r.id))
}

/** Marks a fresh re-authentication (password, TOTP, OAuth reauth or, for demo sessions in development, the demo confirm). */
export async function markReauth(sessionId: string, userId: string, opts: { mfa?: boolean } = {}) {
  const d = await db()
  const now = new Date()
  const [row] = await d
    .update(sessionAuth)
    .set({ reauthAt: now, ...(opts.mfa ? { mfaAt: now } : {}) })
    .where(eq(sessionAuth.sessionId, sessionId))
    .returning({ id: sessionAuth.sessionId })
  if (!row) await d.insert(sessionAuth).values({ sessionId, userId, method: "demo", reauthAt: now, mfaAt: opts.mfa ? now : null })
}
