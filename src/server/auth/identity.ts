import "server-only"
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import { adminRolePermissions, brandRolePermissions, type AdminRole, type MemberRole } from "@/lib/permissions"
import type { AdminProfile, BrandProfile, ShopperProfile } from "@/lib/api/contracts/session"
import { writeAudit } from "../audit"
import { db, withTx, type Tx } from "../db"
import { adminMembers, brandMembers, brands, sessions, users } from "../db/schema"
import { accountDeletions, adminMfa, userCredentials } from "../db/schema/identity"
import { enqueueEmail } from "../email"
import { HttpError, badRequest, rateLimited, suspended } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { authLinks } from "./auth-env"
import { clearSignInEmailLimit, limitEmailSend, limitSignIn, limitTokenConsume, LOCKOUT } from "./limits"
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from "./passwords"
import { createSession, endCurrentSession, endSession, endSessionsForUser, type ActorKind } from "./session"
import { recordSessionAuth, type AuthMethod } from "./session-auth"
import { consumeToken, issueToken, voidTokens } from "./tokens"

/**
 * Real identities (v3): email + password with verification, reset and lockout; magic link;
 * the session opener every real sign-in goes through. The session API (cookies, DAL, /api/session)
 * is F1's and unchanged: real sign-ins create the same `sessions` rows plus a `session_auth` row.
 *
 * Rules kept here:
 *  - scrypt runs OUTSIDE transactions (CPU work would stall PGlite's single connection, §1.3);
 *  - a failed attempt is committed on its own, never rolled back by the error that reports it;
 *  - endpoints that take an email never say whether an account exists (same answer, same timing);
 *  - emails go through ENGAGEMENT's durable outbox (enqueueEmail) inside the transaction.
 */

export type RequestMeta = { ipHash: string | null; userAgent: string | null }
export type UserRow = typeof users.$inferSelect
export type SignInActor = ActorKind

export const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** Email template names used by AUTH (ENGAGEMENT renders them; vars are plain strings/numbers). */
export const AUTH_EMAIL_TEMPLATES = {
  verifyEmail: "verification", // vars: name, url, expiresMinutes
  resetPassword: "reset", // vars: name, url, expiresMinutes
  passwordChanged: "password_changed", // vars: name
  magicLink: "magic_link", // vars: name, url, expiresMinutes
  brandInvite: "team_invite", // vars: brand, role, inviter, url, expiresDays
  accountDeleted: "account_deleted", // vars: name
  mfaReset: "mfa_reset", // vars: name
  foundingClaim: "founding_claim", // vars: brand, handle, url, expiresDays
} as const

/** Queues an auth email in the caller's transaction (dedupe keys make retries harmless). */
export async function sendAuthEmail(tx: Tx, template: string, to: string, vars: Record<string, string | number>, dedupeKey: string) {
  await enqueueEmail(tx, { template, to, vars, dedupeKey })
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const d = await db()
  const [u] = await d
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1)
  return u ?? null
}

export async function userById(id: string): Promise<UserRow | null> {
  const d = await db()
  const [u] = await d.select().from(users).where(eq(users.id, id)).limit(1)
  return u ?? null
}

export async function credentialsOf(userId: string) {
  const d = await db()
  const [c] = await d.select().from(userCredentials).where(eq(userCredentials.userId, userId)).limit(1)
  return c ?? null
}

/** Inserts the credentials row when missing and applies `patch`. */
export async function upsertCredentials(userId: string, patch: Partial<typeof userCredentials.$inferInsert>) {
  const d = await db()
  const now = new Date()
  await d
    .insert(userCredentials)
    .values({ userId, ...patch, updatedAt: now })
    .onConflictDoUpdate({ target: userCredentials.userId, set: { ...patch, updatedAt: now } })
}

export async function deletionPending(userId: string) {
  const d = await db()
  const [row] = await d
    .select({ id: accountDeletions.id })
    .from(accountDeletions)
    .where(and(eq(accountDeletions.userId, userId), inArray(accountDeletions.status, ["pending", "processing"])))
    .limit(1)
  return !!row
}

/** A real (non-demo) user that may sign in: exists, not suspended, no deletion pending. */
async function signInCandidate(email: string) {
  const user = await findUserByEmail(email)
  if (!user || user.demo) return null
  if (await deletionPending(user.id)) return null
  return user
}

// ---------------------------------------------------------------------------------------------
// Profiles (the same narrow shapes GET /api/session returns)

export type AnyProfile = ShopperProfile | BrandProfile | AdminProfile

export async function profileFor(actor: ActorKind, user: UserRow, brandId: string | null): Promise<AnyProfile> {
  const d = await db()
  if (actor === "shopper") return { id: user.id, name: user.name, email: user.email, status: user.status as ShopperProfile["status"], demo: user.demo }
  if (actor === "admin") {
    const [m] = await d.select().from(adminMembers).where(eq(adminMembers.userId, user.id)).limit(1)
    const role = (m?.role ?? "support") as AdminRole
    return { id: user.id, name: user.name, role, permissions: adminRolePermissions[role], demo: user.demo }
  }
  const [b] = await d.select().from(brands).where(eq(brands.id, brandId ?? "")).limit(1)
  const [m] = await d
    .select()
    .from(brandMembers)
    .where(and(eq(brandMembers.brandId, brandId ?? ""), eq(brandMembers.userId, user.id)))
    .limit(1)
  const role = (m?.role ?? "viewer") as MemberRole
  return {
    userId: user.id,
    name: user.name,
    brand: { id: b.id, handle: b.handle, name: b.name, reviewStatus: b.reviewStatus as BrandProfile["brand"]["reviewStatus"] },
    role,
    permissions: brandRolePermissions[role],
    // Yard setup works on a real founding brand, so Studio reads its live data even when the admin
    // doing the setup is a demo account (demo here means "show the browser's sample brand").
    demo: role === "yard_setup" ? false : user.demo,
  }
}

// ---------------------------------------------------------------------------------------------
// Eligibility per actor kind

/** The brand a brand session opens on: `brandId` if it's an active membership, else the first. */
export async function brandForUser(userId: string, brandId?: string | null) {
  const d = await db()
  const memberships = await d
    .select({ brandId: brandMembers.brandId, reviewStatus: brands.reviewStatus })
    .from(brandMembers)
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    // Yard setup rows are never a sign-in target: only the admin setup route opens those sessions.
    .where(and(eq(brandMembers.userId, userId), eq(brandMembers.status, "active"), ne(brandMembers.role, "yard_setup")))
    .orderBy(asc(brandMembers.createdAt), asc(brandMembers.id))
  if (!memberships.length) throw new HttpError(403, "forbidden", "This account isn't a member of any brand on Yard. Ask the brand's owner for an invite.")
  const chosen = brandId ? memberships.find((m) => m.brandId === brandId) : (memberships.find((m) => m.reviewStatus !== "suspended") ?? memberships[0])
  if (!chosen) throw badRequest({ brandId: "You aren't a member of this brand." })
  if (chosen.reviewStatus === "suspended") throw suspended("This brand is suspended by Yard.")
  return chosen.brandId
}

/** Throws when `user` may not hold a session of kind `actor`; returns the active brand for brand sessions. */
export async function assertEligible(actor: ActorKind, user: UserRow, brandId?: string | null): Promise<string | null> {
  if (user.status === "suspended") throw suspended("This account is suspended.")
  if (actor === "shopper") {
    if (user.kind !== "shopper" && user.kind !== "brand_staff") throw new HttpError(403, "forbidden", "This account can't shop on Yard. Use the Control Center instead.")
    return null
  }
  if (actor === "admin") {
    const d = await db()
    const [m] = await d.select().from(adminMembers).where(eq(adminMembers.userId, user.id)).limit(1)
    if (!m) throw new HttpError(403, "forbidden", "This account isn't a Yard admin.")
    return null
  }
  return brandForUser(user.id, brandId)
}

// ---------------------------------------------------------------------------------------------
// Opening a session

/**
 * Opens a real session of kind `actor` (Route Handlers only: it sets the cookie). Ends this
 * browser's previous session of the same kind first, records how it was established, and audits
 * admin sign-ins. Must run inside withTx.
 */
export async function openSession(input: { actor: ActorKind; user: UserRow; brandId: string | null; method: AuthMethod; mfa?: boolean; meta: RequestMeta }) {
  const { actor, user, brandId, method, meta } = input
  if (actor === "admin" && !input.mfa) throw new Error("admin sessions require MFA")
  const previous = await endCurrentSession(actor, "replaced")
  const row = await createSession(actor, user.id, brandId, { userAgent: meta.userAgent, ipHash: meta.ipHash })
  await recordSessionAuth({ sessionId: row.id, userId: user.id, method, mfa: input.mfa })
  await upsertCredentials(user.id, { lastSignInAt: new Date() })
  if (actor === "admin") {
    const d = await db()
    const [m] = await d.select().from(adminMembers).where(eq(adminMembers.userId, user.id)).limit(1)
    await writeAudit({
      actor: { kind: "admin", id: user.id, name: user.name, role: m?.role ?? null },
      action: "admin.signed_in",
      target: user.name,
      subjectType: "session",
      subjectId: row.id,
      ipHash: meta.ipHash,
      meta: { method, mfa: true, replacedSession: previous?.id ?? null },
    })
  }
  return { session: row, profile: await profileFor(actor, user, brandId) }
}

// ---------------------------------------------------------------------------------------------
// Sign-up and email verification

/**
 * Sign-up never reveals whether the email already has an account: both cases answer
 * `{ status: 'verify_email' }`. A new account gets a verification email (verifying signs it in);
 * an existing one gets a "you already have an account" email instead.
 */
export async function signUp(input: { name: string; email: string; password: string }, meta: RequestMeta) {
  const email = normalizeEmail(input.email)
  await limitEmailSend("signup", email, meta.ipHash)
  const problem = passwordProblem(input.password, email)
  if (problem) throw badRequest({ password: problem })
  const hash = await hashPassword(input.password) // outside the transaction
  const existing = await findUserByEmail(email)
  await withTx(async (tx) => {
    if (existing) {
      // Demo accounts, admins and pending deletions get nothing. A real shopper account gets a
      // sign-in link instead (ENGAGEMENT's magic_link template), which is what they need anyway.
      if (!existing.demo && (existing.kind === "shopper" || existing.kind === "brand_staff") && existing.status !== "suspended" && !(await deletionPending(existing.id))) {
        // Pre-hijack guard: an UNVERIFIED account's password was chosen by whoever signed up first,
        // which may not be the owner of this address. A second sign-up for it drops that password,
        // kills the old verification links and any sessions, so only the emailed link gets in.
        const cred = await credentialsOf(existing.id)
        if (!cred?.emailVerifiedAt) await supersedeUnverified(existing.id, "signup_superseded")
        const t = await issueToken(existing.id, "magic_link", { email: existing.email })
        await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.magicLink, existing.email, { name: existing.name, url: authLinks.magicLink(t.token), expiresMinutes: t.ttlMinutes }, `magic:${existing.id}:${t.expiresAt.getTime()}`)
      }
      return
    }
    const d = await db()
    const id = newId("u")
    await d.insert(users).values({ id, kind: "shopper", name: input.name.trim(), email, status: "active", demo: false })
    await upsertCredentials(id, { passwordHash: hash, passwordUpdatedAt: new Date() })
    const t = await issueToken(id, "verify_email", { email })
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.verifyEmail, email, { name: input.name.trim(), url: authLinks.verifyEmail(t.token), expiresMinutes: t.ttlMinutes }, `verify:${id}:${t.expiresAt.getTime()}`)
  })
  return { status: "verify_email" as const }
}

/**
 * Pre-hijack guard (v3): strips what someone may have set up on an account before its email was
 * proven. Drops the password (unless `keepPassword`), ends every session of the user and voids
 * outstanding email tokens. Runs in the caller's transaction.
 */
async function supersedeUnverified(userId: string, reason: string, opts: { keepPassword?: boolean } = {}) {
  if (!opts.keepPassword) await upsertCredentials(userId, { passwordHash: null, passwordUpdatedAt: null })
  await voidTokens(userId, ["verify_email", "magic_link", "reset_password"])
  await endSessionsForUser(userId, ["shopper", "brand", "admin"], reason)
}

/** Re-sends verification. Same answer whether or not the account exists or is already verified. */
export async function requestEmailVerification(emailRaw: string, meta: RequestMeta) {
  const email = normalizeEmail(emailRaw)
  await limitEmailSend("verify", email, meta.ipHash)
  const user = await signInCandidate(email)
  if (!user) return { ok: true as const }
  const cred = await credentialsOf(user.id)
  if (cred?.emailVerifiedAt) return { ok: true as const }
  await withTx(async (tx) => {
    const t = await issueToken(user.id, "verify_email", { email: user.email })
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.verifyEmail, user.email, { name: user.name, url: authLinks.verifyEmail(t.token), expiresMinutes: t.ttlMinutes }, `verify:${user.id}:${t.expiresAt.getTime()}`)
  })
  return { ok: true as const }
}

/**
 * Confirms an email address. The token must still match the user's current email. Signs the
 * person in as a shopper when the account can shop (that is the end of sign-up).
 */
export async function confirmEmailVerification(token: string, meta: RequestMeta) {
  await limitTokenConsume("verify", meta.ipHash)
  return withTx(async () => {
    const row = await consumeToken(token, "verify_email")
    if (!row) throw badRequest({ token: "This link has expired or was already used. Ask for a new one." }, "This link has expired or was already used.")
    const user = await userById(row.userId)
    const tokenEmail = typeof (row.meta as { email?: unknown }).email === "string" ? ((row.meta as { email: string }).email) : null
    if (!user || user.demo || !tokenEmail || normalizeEmail(user.email) !== normalizeEmail(tokenEmail)) throw badRequest({ token: "This link is no longer valid. Ask for a new one." }, "This link is no longer valid.")
    // First proof of the email: the password set at sign-up is kept (this link was sent for that
    // sign-up, and a second sign-up for an unverified address drops it), but nothing else from
    // before verification survives: other sessions end and other email links are voided.
    if (!(await credentialsOf(user.id))?.emailVerifiedAt) await supersedeUnverified(user.id, "email_verified", { keepPassword: true })
    await upsertCredentials(user.id, { emailVerifiedAt: new Date() })
    if (user.status === "suspended" || (user.kind !== "shopper" && user.kind !== "brand_staff")) return { status: "verified" as const, signedIn: false as const }
    const out = await openSession({ actor: "shopper", user, brandId: null, method: "email_verification", meta })
    return { status: "verified" as const, signedIn: true as const, actor: "shopper" as const, profile: out.profile }
  })
}

// ---------------------------------------------------------------------------------------------
// Password sign-in with lockout

export type SignInResult =
  | { status: "signed_in"; actor: ActorKind; profile: AnyProfile }
  | { status: "verify_email" }
  | { status: "mfa_required" | "mfa_enrol_required"; challenge: string; expiresAt: string }

const wrongPassword = () => new HttpError(401, "unauthenticated", "That email and password don't match.")

async function recordFailure(userId: string, current: { failedCount: number; firstFailedAt: Date | null } | null) {
  const now = new Date()
  const windowStart = new Date(now.getTime() - LOCKOUT.windowMin * 60_000)
  const fresh = !current?.firstFailedAt || current.firstFailedAt < windowStart
  const failedCount = fresh ? 1 : current!.failedCount + 1
  const lockedUntil = failedCount >= LOCKOUT.failures ? new Date(now.getTime() + LOCKOUT.lockMin * 60_000) : null
  // Committed on its own (no ambient transaction here), so the 401 that follows can't roll it back.
  await upsertCredentials(userId, { failedCount: lockedUntil ? 0 : failedCount, firstFailedAt: lockedUntil ? null : fresh ? now : current!.firstFailedAt, ...(lockedUntil ? { lockedUntil } : {}) })
  if (lockedUntil) log.warn(`[yard] auth: account ${userId} locked for ${LOCKOUT.lockMin} min after ${LOCKOUT.failures} failed sign-ins`)
}

/**
 * Email + password. Order: IP/email rate limits → lockout → scrypt (always, even for unknown
 * emails) → failure bookkeeping or eligibility → session (or the admin MFA step).
 */
export async function signInWithPassword(input: { email: string; password: string; actor: ActorKind; brandId?: string | null }, meta: RequestMeta): Promise<SignInResult> {
  const email = normalizeEmail(input.email)
  await limitSignIn(email, meta.ipHash, input.actor)
  const user = await signInCandidate(email)
  const cred = user ? await credentialsOf(user.id) : null
  if (cred?.lockedUntil && cred.lockedUntil.getTime() > Date.now()) {
    // Same wording as the per-email limiter, which also covers emails without accounts.
    throw rateLimited(Math.ceil((cred.lockedUntil.getTime() - Date.now()) / 1000), "Too many attempts. Try again in a few minutes, or reset your password.")
  }
  const ok = await verifyPassword(input.password, cred?.passwordHash ?? null)
  if (!user || !ok) {
    if (user) await recordFailure(user.id, cred)
    throw wrongPassword()
  }
  // Correct password from here on.
  const patch: Partial<typeof userCredentials.$inferInsert> = { failedCount: 0, firstFailedAt: null, lockedUntil: null }
  if (cred?.passwordHash && needsRehash(cred.passwordHash)) patch.passwordHash = await hashPassword(input.password)
  await upsertCredentials(user.id, patch)

  const brandId = await assertEligible(input.actor, user, input.brandId)
  if (!cred?.emailVerifiedAt) {
    await requestEmailVerification(email, meta).catch(() => undefined)
    return { status: "verify_email" }
  }
  if (input.actor === "admin") {
    const d = await db()
    const [mfa] = await d.select().from(adminMfa).where(eq(adminMfa.userId, user.id)).limit(1)
    const enrolled = !!mfa?.enabledAt
    const t = await withTx(() => issueToken(user.id, "mfa_challenge", { actor: "admin", stage: enrolled ? "verify" : "enrol", ipHash: meta.ipHash }))
    return { status: enrolled ? "mfa_required" : "mfa_enrol_required", challenge: t.token, expiresAt: t.expiresAt.toISOString() }
  }
  return withTx(async () => {
    const out = await openSession({ actor: input.actor, user, brandId, method: "password", meta })
    return { status: "signed_in" as const, actor: input.actor, profile: out.profile }
  })
}

// ---------------------------------------------------------------------------------------------
// Password reset and change

export async function requestPasswordReset(emailRaw: string, meta: RequestMeta) {
  const email = normalizeEmail(emailRaw)
  await limitEmailSend("reset", email, meta.ipHash)
  const user = await signInCandidate(email)
  if (!user || user.status === "suspended") return { ok: true as const }
  await withTx(async (tx) => {
    const t = await issueToken(user.id, "reset_password", { email: user.email })
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.resetPassword, user.email, { name: user.name, url: authLinks.resetPassword(t.token), expiresMinutes: t.ttlMinutes }, `reset:${user.id}:${t.expiresAt.getTime()}`)
  })
  return { ok: true as const }
}

/**
 * Sets a new password from a reset link. Proves the email too (marks it verified), clears the
 * lockout, ends every session of the user and voids their other tokens. Doesn't sign in: the
 * person signs in with the new password (admins then pass TOTP as usual).
 */
export async function resetPassword(token: string, password: string, meta: RequestMeta) {
  await limitTokenConsume("reset", meta.ipHash)
  const hash = await hashPassword(password)
  const out = await withTx(async (tx) => {
    const row = await consumeToken(token, "reset_password")
    if (!row) throw badRequest({ token: "This reset link has expired or was already used. Ask for a new one." }, "This reset link has expired or was already used.")
    const user = await userById(row.userId)
    const tokenEmail = (row.meta as { email?: string }).email
    if (!user || user.demo || !tokenEmail || normalizeEmail(user.email) !== normalizeEmail(tokenEmail)) throw badRequest({ token: "This reset link is no longer valid." })
    const problem = passwordProblem(password, user.email)
    if (problem) throw badRequest({ password: problem })
    const now = new Date()
    await upsertCredentials(user.id, { passwordHash: hash, passwordUpdatedAt: now, emailVerifiedAt: now, failedCount: 0, firstFailedAt: null, lockedUntil: null })
    await voidTokens(user.id, ["reset_password", "magic_link", "mfa_challenge"])
    await endSessionsForUser(user.id, ["shopper", "brand", "admin"], "password_reset")
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.passwordChanged, user.email, { name: user.name }, `pw-changed:${user.id}:${now.getTime()}`)
    await writeAudit({ actor: { kind: "system" }, action: "auth.password_reset", target: user.name, subjectType: "user", subjectId: user.id, ipHash: meta.ipHash })
    return { email: user.email }
  })
  // Committed: the per-email sign-in window goes with the lockout (see clearSignInEmailLimit).
  clearSignInEmailLimit(out.email)
  return { ok: true as const }
}

/** Signed-in password change. Ends the user's OTHER sessions; keeps this one. */
export async function changePassword(input: { userId: string; sessionId: string; current: string | null; next: string }, meta: RequestMeta) {
  const user = await userById(input.userId)
  if (!user || user.demo) throw new HttpError(422, "rule", "Demo accounts have no password.")
  const cred = await credentialsOf(user.id)
  if (cred?.passwordHash) {
    if (!input.current) throw badRequest({ currentPassword: "Enter your current password." })
    if (!(await verifyPassword(input.current, cred.passwordHash))) {
      await recordFailure(user.id, cred)
      throw badRequest({ currentPassword: "That isn't your current password." })
    }
  }
  const problem = passwordProblem(input.next, user.email)
  if (problem) throw badRequest({ newPassword: problem })
  const hash = await hashPassword(input.next)
  await withTx(async (tx) => {
    const now = new Date()
    await upsertCredentials(user.id, { passwordHash: hash, passwordUpdatedAt: now, failedCount: 0, firstFailedAt: null, lockedUntil: null })
    const d = await db()
    const others = await d
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), sql`${sessions.id} <> ${input.sessionId}`))
    for (const o of others) await endSession(o.id, "password_changed")
    await voidTokens(user.id, ["reset_password", "magic_link"])
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.passwordChanged, user.email, { name: user.name }, `pw-changed:${user.id}:${now.getTime()}`)
    await writeAudit({ actor: { kind: "shopper", id: user.id, name: user.name }, action: "auth.password_changed", target: user.name, subjectType: "user", subjectId: user.id, ipHash: meta.ipHash, meta: { endedSessions: others.length } })
  })
  return { ok: true as const }
}

// ---------------------------------------------------------------------------------------------
// Magic link (shoppers)

export async function requestMagicLink(emailRaw: string, meta: RequestMeta) {
  const email = normalizeEmail(emailRaw)
  await limitEmailSend("magic", email, meta.ipHash)
  const user = await signInCandidate(email)
  if (!user || user.status === "suspended" || (user.kind !== "shopper" && user.kind !== "brand_staff")) return { ok: true as const }
  await withTx(async (tx) => {
    const t = await issueToken(user.id, "magic_link", { email: user.email })
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.magicLink, user.email, { name: user.name, url: authLinks.magicLink(t.token), expiresMinutes: t.ttlMinutes }, `magic:${user.id}:${t.expiresAt.getTime()}`)
  })
  return { ok: true as const }
}

/** Consumes a magic link (POSTed by the /auth/magic page): proves the email and opens a shopper session. */
export async function consumeMagicLink(token: string, meta: RequestMeta) {
  await limitTokenConsume("magic", meta.ipHash)
  return withTx(async () => {
    const row = await consumeToken(token, "magic_link")
    if (!row) throw badRequest({ token: "This sign-in link has expired or was already used. Ask for a new one." }, "This sign-in link has expired or was already used.")
    const user = await userById(row.userId)
    const tokenEmail = (row.meta as { email?: string }).email
    if (!user || user.demo || !tokenEmail || normalizeEmail(user.email) !== normalizeEmail(tokenEmail)) throw badRequest({ token: "This sign-in link is no longer valid." })
    if (await deletionPending(user.id)) throw badRequest({ token: "This sign-in link is no longer valid." })
    await assertEligible("shopper", user)
    // First proof of the email by magic link: a password set before verification was not chosen
    // through this inbox, so it goes, with every earlier session (pre-hijack guard). The owner can
    // set a password afterwards from this fresh session.
    if (!(await credentialsOf(user.id))?.emailVerifiedAt) await supersedeUnverified(user.id, "email_verified")
    await upsertCredentials(user.id, { emailVerifiedAt: new Date() })
    const out = await openSession({ actor: "shopper", user, brandId: null, method: "magic_link", meta })
    return { status: "signed_in" as const, actor: "shopper" as const, profile: out.profile }
  })
}
