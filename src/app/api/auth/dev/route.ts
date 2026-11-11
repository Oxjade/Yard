import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { createAdminAccount } from "@/server/auth/admins"
import { processDueErasures } from "@/server/auth/erasure"
import { findUserByEmail, userById } from "@/server/auth/identity"
import { endSessionsForUser } from "@/server/auth/session"
import { db, withTx } from "@/server/db"
import { adminMembers, brandMembers, emailOutbox, sessions, users } from "@/server/db/schema"
import { accountDeletions, adminMfa, authTokens, AUTH_TOKEN_PURPOSES, brandInvites, mfaRecoveryCodes, sessionAuth, userCredentials } from "@/server/db/schema/identity"
import { getEnv } from "@/server/env"
import { badRequest, notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/**
 * Test-only helpers for the AUTH acceptance kit (scripts/checks/v3-auth.mjs). Development only:
 * 404 in production before anything else runs. Every operation is limited to accounts whose
 * email contains "t_v3_" (or that account after erasure), so a kit can never read or change
 * seeded or real data.
 *
 * GET  ?op=outbox&email=…               → { emails: [{ template, toEmail, vars, status, createdAt }] } (newest first)
 * GET  ?op=inspect&email=… | &userId=…  → user, credentials (no hash), sessions, session_auth, deletions, brand memberships, mfa
 * POST { op: "bootstrap-admin", email, name, role } → a real admin via createAdminAccount(null, …)
 * POST { op: "age-reauth", email, seconds }        → moves every session_auth.reauth_at of that user back by `seconds`
 * POST { op: "expire-tokens", email, purpose }     → expires the user's live tokens of `purpose`
 * POST { op: "run-erasures" }                      → processDueErasures()
 * POST { op: "retire-admin", email }               → removes a kit admin's admin role, TOTP and sessions; suspends the user
 * POST { op: "expire-claim-links", email }         → backdates the pending founding-brand claim links sent to that address
 */

const TAG = "t_v3_"
const tagged = (email: string | null | undefined) => !!email && email.toLowerCase().includes(TAG)

const getQuery = z.object({
  op: z.enum(["outbox", "inspect"]),
  email: z.string().max(254).optional(),
  userId: z.string().max(64).optional(),
})

const postBody = z.discriminatedUnion("op", [
  z.object({ op: z.literal("bootstrap-admin"), email: z.string().email().max(254), name: z.string().min(1).max(80), role: z.enum(["owner", "finance", "trust_safety", "support", "ads_ops", "engineering"]) }),
  z.object({ op: z.literal("age-reauth"), email: z.string().max(254), seconds: z.number().int().min(0).max(86_400) }),
  z.object({ op: z.literal("expire-tokens"), email: z.string().max(254), purpose: z.enum(AUTH_TOKEN_PURPOSES) }),
  z.object({ op: z.literal("run-erasures") }),
  z.object({ op: z.literal("retire-admin"), email: z.string().max(254) }),
  z.object({ op: z.literal("expire-claim-links"), email: z.string().max(254) }),
])

async function taggedUser(email?: string, userId?: string) {
  const u = email ? await findUserByEmail(email) : userId ? await userById(userId) : null
  if (!u || u.demo) throw notFound("No such test account.")
  if (!tagged(u.email) && !u.email.startsWith(`deleted+${u.id}@`)) throw notFound("No such test account.")
  return u
}

const getHandler = route({ auth: "public", query: getQuery }, async ({ query }) => {
  const d = await db()
  if (query.op === "outbox") {
    if (!query.email || !tagged(query.email)) throw badRequest({ email: `Only addresses containing ${TAG}.` })
    const rows = await d
      .select({ template: emailOutbox.template, toEmail: emailOutbox.toEmail, vars: emailOutbox.vars, status: emailOutbox.status, createdAt: emailOutbox.createdAt })
      .from(emailOutbox)
      .where(sql`lower(${emailOutbox.toEmail}) = ${query.email.trim().toLowerCase()}`)
      .orderBy(desc(emailOutbox.createdAt))
      .limit(50)
    return { emails: rows }
  }
  const u = await taggedUser(query.email, query.userId)
  const [cred] = await d.select().from(userCredentials).where(eq(userCredentials.userId, u.id)).limit(1)
  const sess = await d.select({ id: sessions.id, actor: sessions.actor }).from(sessions).where(eq(sessions.userId, u.id))
  const auth = await d.select().from(sessionAuth).where(eq(sessionAuth.userId, u.id))
  const dels = await d.select().from(accountDeletions).where(eq(accountDeletions.userId, u.id)).orderBy(desc(accountDeletions.requestedAt))
  const members = await d.select({ brandId: brandMembers.brandId, role: brandMembers.role, status: brandMembers.status }).from(brandMembers).where(eq(brandMembers.userId, u.id))
  const [mfa] = await d.select({ enabledAt: adminMfa.enabledAt, lastStep: adminMfa.lastStep }).from(adminMfa).where(eq(adminMfa.userId, u.id)).limit(1)
  const liveTokens = await d
    .select({ purpose: authTokens.purpose })
    .from(authTokens)
    .where(and(eq(authTokens.userId, u.id), isNull(authTokens.usedAt)))
  return {
    user: { id: u.id, kind: u.kind, name: u.name, email: u.email, status: u.status, demo: u.demo, city: u.city, country: u.country },
    credentials: cred
      ? { hasPassword: !!cred.passwordHash, emailVerifiedAt: cred.emailVerifiedAt, failedCount: cred.failedCount, firstFailedAt: cred.firstFailedAt, lockedUntil: cred.lockedUntil, lastSignInAt: cred.lastSignInAt }
      : null,
    sessions: sess,
    sessionAuth: auth.map((a) => ({ sessionId: a.sessionId, method: a.method, mfaAt: a.mfaAt, reauthAt: a.reauthAt })),
    deletions: dels.map((x) => ({ id: x.id, status: x.status, attempts: x.attempts, meta: x.meta, lastError: x.lastError })),
    brandMembers: members,
    mfa: mfa ?? null,
    liveTokens: liveTokens.map((t) => t.purpose),
  }
})

const postHandler = route({ auth: "public", body: postBody, maxBody: 2 * 1024 }, async ({ body, ipHash }) => {
  const d = await db()
  switch (body.op) {
    case "bootstrap-admin": {
      if (!tagged(body.email)) throw badRequest({ email: `Only addresses containing ${TAG}.` })
      return createAdminAccount(null, { email: body.email, name: body.name, role: body.role }, { ipHash, userAgent: null })
    }
    case "age-reauth": {
      const u = await taggedUser(body.email)
      const rows = await d
        .update(sessionAuth)
        .set({ reauthAt: sql`coalesce(${sessionAuth.reauthAt}, now()) - make_interval(secs => ${body.seconds})` })
        .where(eq(sessionAuth.userId, u.id))
        .returning({ id: sessionAuth.sessionId })
      return { aged: rows.length }
    }
    case "expire-tokens": {
      const u = await taggedUser(body.email)
      const rows = await d
        .update(authTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(and(eq(authTokens.userId, u.id), eq(authTokens.purpose, body.purpose), isNull(authTokens.usedAt)))
        .returning({ id: authTokens.id })
      return { expired: rows.length }
    }
    case "run-erasures":
      return processDueErasures()
    case "expire-claim-links": {
      // Claim links name an address that may have no account yet, so the tag is checked on the address itself.
      if (!tagged(body.email)) throw badRequest({ email: `Only addresses containing ${TAG}.` })
      const rows = await d
        .update(brandInvites)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(and(sql`lower(${brandInvites.email}) = ${body.email.trim().toLowerCase()}`, eq(brandInvites.kind, "founding_claim"), eq(brandInvites.status, "pending")))
        .returning({ id: brandInvites.id })
      return { expired: rows.length }
    }
    case "retire-admin": {
      const u = await taggedUser(body.email)
      if (u.kind !== "admin") throw badRequest({ email: "Not an admin account." })
      await withTx(async () => {
        const t = await db()
        await t.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, u.id))
        await t.delete(adminMfa).where(eq(adminMfa.userId, u.id))
        await t.delete(adminMembers).where(eq(adminMembers.userId, u.id))
        await endSessionsForUser(u.id, ["shopper", "brand", "admin"], "suspended")
        await t.update(userCredentials).set({ passwordHash: null }).where(eq(userCredentials.userId, u.id))
        await t.update(users).set({ status: "suspended" }).where(eq(users.id, u.id))
      })
      return { ok: true }
    }
  }
})

const off = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return off()
  return getHandler(req, ctx)
}

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return off()
  return postHandler(req, ctx)
}
