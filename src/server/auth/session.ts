import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { cookies } from "next/headers"
import { writeAudit } from "../audit"
import { afterCommit, db, withTx } from "../db"
import { sessions } from "../db/schema"
import { getEnv } from "../env"
import { newId, randomToken } from "../ids"
import { log } from "../log"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { hmacB64url, safeEqual, sha256hex } from "../security/crypto"
import { keys } from "../security/keys"
import { yard } from "../state"

/**
 * Server sessions (§2.1). One cookie per actor kind, so one browser can be shopper, brand member
 * and admin at once. The cookie is `${token}.${HMAC(keys.session, token)}`; the database stores
 * only sha256(token). The row id (ses_*) is stable and names the session:<id> channel.
 */
export type ActorKind = "shopper" | "brand" | "admin"
export type SessionRow = typeof sessions.$inferSelect

const HOUR = 3600_000
const DAY = 24 * HOUR

export const sessionPolicy: Record<ActorKind, { cookie: string; sameSite: "lax" | "strict"; idleMs: number; absoluteMs: number; renewMs: number }> = {
  shopper: { cookie: "yard_s", sameSite: "lax", idleMs: 30 * DAY, absoluteMs: 90 * DAY, renewMs: DAY },
  brand: { cookie: "yard_b", sameSite: "lax", idleMs: 7 * DAY, absoluteMs: 7 * DAY, renewMs: DAY },
  // Strict is safe: the Admin client fetches from its own same-site pages (§2.1).
  admin: { cookie: "yard_a", sameSite: "strict", idleMs: 12 * HOUR, absoluteMs: 7 * DAY, renewMs: HOUR },
}

/** `__Host-yard_s` when YARD_PUBLIC_URL is https (forces Secure, path=/ and no Domain). */
export function cookieName(actor: ActorKind) {
  return (getEnv().cookieSecure ? "__Host-" : "") + sessionPolicy[actor].cookie
}

const sign = (token: string) => `${token}.${hmacB64url(keys().session, token)}`

/** Verifies the HMAC before any DB hit, so tampered cookies cost nothing. */
export function verifyCookieValue(value: string | undefined | null): string | null {
  if (!value) return null
  const dot = value.lastIndexOf(".")
  if (dot < 20) return null
  const token = value.slice(0, dot)
  if (!/^[\w-]{40,64}$/.test(token)) return null
  return safeEqual(value, sign(token)) ? token : null
}

/**
 * After a rotation, the replaced token stays usable for a few seconds so requests already in
 * flight with the old cookie don't read as signed out (single process: an in-memory map).
 */
function rotated() {
  const slots = (yard.slots ??= {})
  return (slots.rotatedSessions ??= new Map<string, { newHash: string; until: number }>()) as Map<string, { newHash: string; until: number }>
}

function cookieOptions(actor: ActorKind, maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: sessionPolicy[actor].sameSite,
    path: "/",
    secure: getEnv().cookieSecure,
    maxAge: Math.max(0, Math.floor(maxAgeMs / 1000)),
  } as const
}

async function setCookie(actor: ActorKind, token: string, maxAgeMs: number) {
  const jar = await cookies()
  jar.set(cookieName(actor), sign(token), cookieOptions(actor, maxAgeMs))
}

export async function clearSessionCookie(actor: ActorKind) {
  const jar = await cookies()
  jar.set(cookieName(actor), "", cookieOptions(actor, 0))
}

/** The verified token of this request's cookie for `actor`, or null. */
export async function cookieToken(actor: ActorKind) {
  const jar = await cookies()
  return verifyCookieValue(jar.get(cookieName(actor))?.value)
}

async function rowByToken(actor: ActorKind, token: string) {
  const d = await db()
  const hash = sha256hex(token)
  let row = await d.query.sessions.findFirst({ where: (s, { and, eq }) => and(eq(s.tokenHash, hash), eq(s.actor, actor)) })
  if (!row) {
    const r = rotated().get(hash)
    if (r && r.until > Date.now()) row = await d.query.sessions.findFirst({ where: (s, { and, eq }) => and(eq(s.tokenHash, r.newHash), eq(s.actor, actor)) })
  }
  return row ?? null
}

/**
 * Every session in this build is a password-less demo session (§2.3), so a session of an actor
 * kind whose demo sign-in is off is no session at all: turning YARD_DEMO_AUTH or YARD_DEMO_ADMIN
 * off ends the sessions it allowed, at the next request (here) and at boot (purgeDisabledSessions).
 */
export function sessionsAllowed(actor: ActorKind) {
  return getEnv().demoAuth[actor]
}

/**
 * The live session row for `actor`, or null. Expired rows, and rows of an actor kind whose demo
 * sign-in is off, are deleted. A session due for renewal gets a new token (rotation), but only
 * where cookies can be written (Route Handlers): in a Server Component the read is left as it is.
 */
export async function loadSession(actor: ActorKind): Promise<SessionRow | null> {
  const token = await cookieToken(actor)
  if (!token) return null
  const row = await rowByToken(actor, token)
  if (!row) return null
  if (!sessionsAllowed(actor)) {
    await endDisabledSessions([row])
    return null
  }
  const now = Date.now()
  if (row.idleExpiresAt.getTime() <= now || row.absoluteExpiresAt.getTime() <= now) {
    const d = await db()
    await d.delete(sessions).where(eq(sessions.id, row.id))
    return null
  }
  if (now - row.lastSeenAt.getTime() >= sessionPolicy[actor].renewMs && sha256hex(token) === row.tokenHash) {
    return (await rotate(actor, row)) ?? row
  }
  return row
}

/**
 * The database half of rotation: a compare-and-swap on the token hash this request saw. Of two
 * parallel requests at the renewal boundary exactly one wins; the other gets the current row.
 * Exported for the dev self-test, which races two of them.
 */
export async function swapToken(actor: ActorKind, row: SessionRow, patch: { activeBrandId?: string | null } = {}) {
  const token = randomToken(32)
  const now = Date.now()
  const idle = new Date(Math.min(now + sessionPolicy[actor].idleMs, row.absoluteExpiresAt.getTime()))
  const d = await db()
  const newHash = sha256hex(token)
  const [updated] = await d
    .update(sessions)
    .set({ tokenHash: newHash, lastSeenAt: new Date(now), idleExpiresAt: idle, ...(patch.activeBrandId !== undefined ? { activeBrandId: patch.activeBrandId } : {}) })
    .where(and(eq(sessions.id, row.id), eq(sessions.tokenHash, row.tokenHash)))
    .returning()
  if (updated) {
    // At once, so a request already holding the old cookie still finds the row (grace map).
    rotated().set(row.tokenHash, { newHash, until: now + 15_000 })
    for (const [k, v] of rotated()) if (v.until < now) rotated().delete(k)
    return { won: true as const, row: updated, token, newHash, maxAgeMs: idle.getTime() - now }
  }
  return { won: false as const, row: (await d.query.sessions.findFirst({ where: (s, { eq }) => eq(s.id, row.id) })) ?? null }
}

/**
 * Issues a new token for the row (renewal, role or active-brand change). Never past the absolute
 * expiry. Only the request that wins the compare-and-swap sets a cookie; a loser sets none and
 * returns the current row, so the browser keeps the winner's cookie (the old token stays valid
 * for 15 s through the grace map). Returns null when nothing changed (a Server Component).
 */
export async function rotate(actor: ActorKind, row: SessionRow, patch: { activeBrandId?: string | null } = {}) {
  const r = await swapToken(actor, row, patch)
  if (!r.won) return r.row
  try {
    await setCookie(actor, r.token, r.maxAgeMs)
  } catch {
    // A Server Component render (cookies are read-only there): nobody else knows the new token,
    // so put the old one back and leave the session as it was.
    rotated().delete(row.tokenHash)
    const d = await db()
    await d
      .update(sessions)
      .set({ tokenHash: row.tokenHash, lastSeenAt: row.lastSeenAt, idleExpiresAt: row.idleExpiresAt, activeBrandId: row.activeBrandId })
      .where(and(eq(sessions.id, row.id), eq(sessions.tokenHash, r.newHash)))
    return null
  }
  return r.row
}

/** Creates a session row and sets its cookie (Route Handlers only). */
export async function createSession(actor: ActorKind, userId: string, activeBrandId: string | null, meta: { userAgent?: string | null; ipHash?: string | null }) {
  const token = randomToken(32)
  const now = Date.now()
  const p = sessionPolicy[actor]
  const idle = new Date(now + Math.min(p.idleMs, p.absoluteMs))
  const d = await db()
  const [row] = await d
    .insert(sessions)
    .values({
      id: newId("ses"),
      tokenHash: sha256hex(token),
      userId,
      actor,
      activeBrandId,
      createdAt: new Date(now),
      lastSeenAt: new Date(now),
      idleExpiresAt: idle,
      absoluteExpiresAt: new Date(now + p.absoluteMs),
      userAgent: meta.userAgent?.slice(0, 200) ?? null,
      ipHash: meta.ipHash ?? null,
    })
    .returning()
  await setCookie(actor, token, idle.getTime() - now)
  return row
}

/** Announces the end of sessions on their own channels, after commit (ephemeral events). */
function announceEnded(ids: string[], reason: string) {
  for (const id of ids)
    afterCommit(async () => {
      await publish(channels.session(id), "session.ended", { reason }, { durable: false })
    })
}

/** Deletes one session and closes its streams (sign-out, or a sign-in replacing it). */
export async function endSession(sessionId: string, reason = "signed_out") {
  const d = await db()
  const gone = await d.delete(sessions).where(eq(sessions.id, sessionId)).returning({ id: sessions.id })
  announceEnded(
    gone.map((g) => g.id),
    reason,
  )
  return gone.length > 0
}

/** Ends this request's own session of `actor` (if it carries a valid one) before a new sign-in. */
export async function endCurrentSession(actor: ActorKind, reason = "replaced") {
  const token = await cookieToken(actor)
  if (!token) return null
  const row = await rowByToken(actor, token)
  if (!row) return null
  await endSession(row.id, reason)
  return row
}

/** Suspension (§2.1, §8.2): every session of the user, of every actor kind unless narrowed. */
export async function endSessionsForUser(userId: string, actors: ActorKind[] = ["shopper", "brand", "admin"], reason = "suspended") {
  const d = await db()
  const gone = await d
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), inArray(sessions.actor, actors)))
    .returning({ id: sessions.id })
  announceEnded(
    gone.map((g) => g.id),
    reason,
  )
  return gone.length
}

/** Brand suspension: every brand session whose active brand is that brand. */
export async function endBrandSessions(brandId: string, reason = "brand_suspended") {
  const d = await db()
  const gone = await d
    .delete(sessions)
    .where(and(eq(sessions.activeBrandId, brandId), eq(sessions.actor, "brand")))
    .returning({ id: sessions.id })
  announceEnded(
    gone.map((g) => g.id),
    reason,
  )
  return gone.length
}

/** Re-reads a session by id (the SSE ping re-validation, §4.2). */
export async function sessionById(id: string) {
  const d = await db()
  const row = await d.query.sessions.findFirst({ where: (s, { eq }) => eq(s.id, id) })
  if (!row) return null
  if (!sessionsAllowed(row.actor as ActorKind)) return null
  const now = Date.now()
  if (row.idleExpiresAt.getTime() <= now || row.absoluteExpiresAt.getTime() <= now) return null
  return row
}

/**
 * Ends sessions whose actor kind may no longer hold one (demo sign-in turned off): deletes them,
 * closes their streams and writes admin.signed_out (reason demo_auth_off) for admin sessions, so
 * the audit log shows each admin session ending (§2.3, §8.3).
 */
async function endDisabledSessions(rows: SessionRow[]) {
  if (!rows.length) return 0
  await withTx(async () => {
    const d = await db()
    const gone = await d
      .delete(sessions)
      .where(inArray(
        sessions.id,
        rows.map((r) => r.id),
      ))
      .returning()
    announceEnded(
      gone.map((g) => g.id),
      "demo_auth_off",
    )
    const admins = gone.filter((g) => g.actor === "admin")
    if (!admins.length) return
    const people = await d.query.users.findMany({ where: (u, { inArray }) => inArray(u.id, admins.map((a) => a.userId)) })
    const roles = await d.query.adminMembers.findMany({ where: (m, { inArray }) => inArray(m.userId, admins.map((a) => a.userId)) })
    for (const a of admins) {
      const u = people.find((p) => p.id === a.userId)
      await writeAudit({
        actor: { kind: "admin", id: a.userId, name: u?.name ?? null, role: roles.find((r) => r.userId === a.userId)?.role ?? null },
        action: "admin.signed_out",
        target: u?.name ?? a.userId,
        subjectType: "session",
        subjectId: a.id,
        reason: "Demo admin sign-in was turned off",
        meta: { demo: true, cause: "demo_auth_off" },
      })
    }
  })
  return rows.length
}

/**
 * Boot (warmUp): deletes every session of an actor kind whose demo sign-in is off, so restarting
 * without YARD_DEMO_AUTH / YARD_DEMO_ADMIN signs those sessions out at once.
 */
export async function purgeDisabledSessions() {
  const off = (["shopper", "brand", "admin"] as const).filter((a) => !sessionsAllowed(a))
  if (!off.length) return 0
  const d = await db()
  const rows = await d.select().from(sessions).where(inArray(sessions.actor, off))
  return endDisabledSessions(rows)
}

export function logSessionProblem(e: unknown) {
  log.error("[yard] session", e)
}
