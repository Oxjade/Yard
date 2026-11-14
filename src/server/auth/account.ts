import "server-only"
import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { users } from "../db/schema"
import { authTokens, oauthIdentities } from "../db/schema/identity"
import { badRequest, conflict, notFound, rule } from "../http/errors"
import { authLinks } from "./auth-env"
import type { BrandActor, ShopperActor } from "./dal"
import { AUTH_EMAIL_TEMPLATES, credentialsOf, findUserByEmail, normalizeEmail, sendAuthEmail, upsertCredentials, userById, type RequestMeta } from "./identity"
import { limitEmailSend, limitTokenConsume } from "./limits"
import { verifyPassword } from "./passwords"
import { requireRecentReauth } from "./reauth"
import { consumeToken, issueToken, voidTokens } from "./tokens"

/**
 * The signed-in person's own name and email (shopper or brand member: one `users` row either way).
 *  - The name saves at once, with the sign-up rules (contracts.ts `name`).
 *  - An email change is a request: it needs the current password (or, for an account without one,
 *    a recent re-auth, the same rule as setting a first password), then a single-use link goes to
 *    the NEW address. Only when that link is opened does `users.email` change; the old address is
 *    then told. An address another account already uses is refused with one generic message, at
 *    the request and again at the confirmation. Sign-in identities (Google, Apple, Auth0) are keyed
 *    by their provider subject, so they keep working after the change.
 */

export type AccountActor = ShopperActor | BrandActor

/** How long a no-password account's re-auth counts for an email change (seconds). */
const REAUTH_MAX_AGE = 600

const TAKEN = "That email can't be used for your account. Try a different address."

export type AccountDto = {
  name: string
  email: string
  emailVerified: boolean
  hasPassword: boolean
  /** Linked sign-in providers ("google", "apple", "auth0"), sorted. */
  signInProviders: string[]
  pendingEmail: { email: string; expiresAt: string } | null
  demo: boolean
}

async function pendingChange(userId: string) {
  const d = await db()
  const [row] = await d
    .select({ meta: authTokens.meta, expiresAt: authTokens.expiresAt })
    .from(authTokens)
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, "change_email"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .orderBy(desc(authTokens.createdAt))
    .limit(1)
  const email = row && typeof (row.meta as { email?: unknown }).email === "string" ? (row.meta as { email: string }).email : null
  return row && email ? { email, expiresAt: row.expiresAt.toISOString() } : null
}

export async function accountOf(userId: string): Promise<AccountDto> {
  const user = await userById(userId)
  if (!user) throw notFound()
  const d = await db()
  const [cred, ids, pending] = await Promise.all([
    credentialsOf(userId),
    d.select({ provider: oauthIdentities.provider }).from(oauthIdentities).where(eq(oauthIdentities.userId, userId)),
    pendingChange(userId),
  ])
  return {
    name: user.name,
    email: user.email,
    emailVerified: !!cred?.emailVerifiedAt,
    hasPassword: !!cred?.passwordHash,
    signInProviders: [...new Set(ids.map((r) => r.provider))].sort(),
    pendingEmail: pending,
    demo: user.demo,
  }
}

/** Saves the display name (already validated by the route's contract). */
export async function changeName(actor: AccountActor, name: string, meta: RequestMeta) {
  const clean = name.trim()
  await withTx(async () => {
    const d = await db()
    const [before] = await d.select({ name: users.name }).from(users).where(eq(users.id, actor.userId)).limit(1)
    if (!before) throw notFound()
    if (before.name === clean) return
    await d.update(users).set({ name: clean }).where(eq(users.id, actor.userId))
    await writeAudit({ actor: { kind: actor.kind, id: actor.userId, name: clean }, action: "account.name_changed", target: clean, subjectType: "user", subjectId: actor.userId, ipHash: meta.ipHash })
  })
  return accountOf(actor.userId)
}

/** Another account (not this one) already holds `email`. */
async function takenByOther(email: string, userId: string) {
  const other = await findUserByEmail(email)
  return !!other && other.id !== userId
}

/**
 * Starts an email change: checks the password (or a recent re-auth), refuses an address in use,
 * and sends the confirmation link to the new address. A new request replaces an older one.
 */
export async function requestEmailChange(actor: AccountActor, input: { email: string; currentPassword?: string }, meta: RequestMeta) {
  const user = await userById(actor.userId)
  if (!user) throw notFound()
  if (user.demo) throw rule("Demo accounts can't change their email.")
  const next = normalizeEmail(input.email)
  if (next === normalizeEmail(user.email)) throw badRequest({ email: "That's already your email." })
  const cred = await credentialsOf(user.id)
  if (cred?.passwordHash) {
    if (!input.currentPassword) throw badRequest({ currentPassword: "Enter your current password." })
    if (!(await verifyPassword(input.currentPassword, cred.passwordHash))) throw badRequest({ currentPassword: "That isn't your current password." })
  } else {
    // No password (Google / Apple / magic link): the same step-up as setting a first password.
    await requireRecentReauth(actor, REAUTH_MAX_AGE)
  }
  if (await takenByOther(next, user.id)) throw badRequest({ email: TAKEN })
  // Counted only for a link that is really sent (a wrong password never spends the address's budget).
  await limitEmailSend("change_email", next, meta.ipHash)
  await withTx(async (tx) => {
    const t = await issueToken(user.id, "change_email", { email: next, from: normalizeEmail(user.email) })
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.changeEmail, next, { name: user.name, url: authLinks.changeEmail(t.token), expiresMinutes: t.ttlMinutes }, `change-email:${user.id}:${t.expiresAt.getTime()}`)
    await writeAudit({ actor: { kind: actor.kind, id: actor.userId, name: user.name }, action: "account.email_change_requested", target: user.name, subjectType: "user", subjectId: user.id, ipHash: meta.ipHash })
  })
  return accountOf(user.id)
}

/** Cancels a pending change: the link already sent stops working. */
export async function cancelEmailChange(actor: AccountActor) {
  await withTx(() => voidTokens(actor.userId, ["change_email"]))
  return accountOf(actor.userId)
}

/**
 * Confirms an email change from the link sent to the new address (POSTed by /auth/change-email;
 * no session needed, so it works in any browser). The account's email must still be the one the
 * request was made from, and the new address must still be free.
 */
export async function confirmEmailChange(token: string, meta: RequestMeta) {
  await limitTokenConsume("change_email", meta.ipHash)
  return withTx(async (tx) => {
    const row = await consumeToken(token, "change_email")
    if (!row) throw badRequest({ token: "This link has expired or was already used. Ask for a new one from your settings." }, "This link has expired or was already used.")
    const m = row.meta as { email?: unknown; from?: unknown }
    const user = await userById(row.userId)
    const next = typeof m.email === "string" ? normalizeEmail(m.email) : null
    const from = typeof m.from === "string" ? normalizeEmail(m.from) : null
    if (!user || user.demo || !next || !from || normalizeEmail(user.email) !== from) throw badRequest({ token: "This link is no longer valid. Ask for a new one from your settings." }, "This link is no longer valid.")
    if (await takenByOther(next, user.id)) throw conflict(TAKEN)
    const d = await db()
    try {
      await d.update(users).set({ email: next }).where(eq(users.id, user.id))
    } catch (e) {
      // users_email_ux: another account took the address between the check and the write.
      if (String((e as { code?: string })?.code ?? "") === "23505" || /users_email_ux/.test(String(e))) throw conflict(TAKEN)
      throw e
    }
    // Opening the link proved the new inbox.
    await upsertCredentials(user.id, { emailVerifiedAt: new Date() })
    await voidTokens(user.id, ["change_email", "verify_email", "magic_link", "reset_password"])
    const now = Date.now()
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.emailChanged, user.email, { name: user.name, email: next }, `email-changed:${user.id}:${now}`)
    await writeAudit({ actor: { kind: "system" }, action: "account.email_changed", target: user.name, subjectType: "user", subjectId: user.id, ipHash: meta.ipHash, meta: { via: "link" } })
    return { status: "changed" as const, email: next }
  })
}
