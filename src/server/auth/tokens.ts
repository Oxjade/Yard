import "server-only"
import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm"
import { db } from "../db"
import { authTokens, AUTH_TOKEN_PURPOSES } from "../db/schema/identity"
import { newId, randomToken } from "../ids"
import { sha256hex } from "../security/crypto"

/**
 * Single-use tokens (verify email, reset password, magic link, MFA challenge). The raw token is
 * 32 random bytes sent once (email link or response body); only sha256 is stored. Consuming is a
 * compare-and-set on used_at, so two parallel consumers can't both win.
 */
export type TokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number]

export const TOKEN_TTL_MIN: Record<TokenPurpose, number> = {
  verify_email: 24 * 60,
  reset_password: 30,
  magic_link: 15,
  mfa_challenge: 10,
}

/** Issues a token. `replace` voids the user's other unused tokens of the same purpose first. */
export async function issueToken(userId: string, purpose: TokenPurpose, meta: Record<string, unknown> = {}, opts: { replace?: boolean; ttlMinutes?: number } = {}) {
  const d = await db()
  if (opts.replace ?? true)
    await d
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)))
  const token = randomToken(32)
  const ttl = opts.ttlMinutes ?? TOKEN_TTL_MIN[purpose]
  const expiresAt = new Date(Date.now() + ttl * 60_000)
  await d.insert(authTokens).values({ id: newId("atk"), userId, purpose, tokenHash: sha256hex(token), meta, expiresAt })
  return { token, expiresAt, ttlMinutes: ttl }
}

const shapeOk = (token: string) => /^[\w-]{40,64}$/.test(token)

/** The live (unused, unexpired) row for a token, without consuming it. */
export async function peekToken(token: string, purpose: TokenPurpose) {
  if (!shapeOk(token)) return null
  const d = await db()
  const [row] = await d
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256hex(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1)
  return row ?? null
}

/** Consumes a token: returns its row once, null when unknown, used, expired or of another purpose. */
export async function consumeToken(token: string, purpose: TokenPurpose) {
  if (!shapeOk(token)) return null
  const d = await db()
  const [row] = await d
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.tokenHash, sha256hex(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning()
  return row ?? null
}

/** Counts a wrong code against a challenge; kills it at `max`. Returns attempts left. */
export async function failChallenge(id: string, max = 5) {
  const d = await db()
  const [row] = await d
    .update(authTokens)
    .set({ attempts: sql`${authTokens.attempts} + 1`, usedAt: sql`case when ${authTokens.attempts} + 1 >= ${max} then now() else ${authTokens.usedAt} end` })
    .where(eq(authTokens.id, id))
    .returning({ attempts: authTokens.attempts })
  return Math.max(0, max - (row?.attempts ?? max))
}

export async function markTokenUsed(id: string) {
  const d = await db()
  await d.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, id))
}

export async function voidTokens(userId: string, purposes?: TokenPurpose[]) {
  const d = await db()
  const rows = await d
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt), purposes?.length ? inArray(authTokens.purpose, purposes) : undefined))
    .returning({ id: authTokens.id })
  return rows.length
}

/** Hourly: drop tokens used or expired more than a day ago. */
export async function purgeTokens() {
  const d = await db()
  const cutoff = new Date(Date.now() - 24 * 3600_000)
  const gone = await d
    .delete(authTokens)
    .where(or(lt(authTokens.expiresAt, cutoff), lt(authTokens.usedAt, cutoff)))
    .returning({ id: authTokens.id })
  return gone.length
}
