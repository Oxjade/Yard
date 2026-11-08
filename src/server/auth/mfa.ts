import "server-only"
import { and, eq, isNull, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { adminMembers } from "../db/schema"
import { adminMfa, mfaRecoveryCodes } from "../db/schema/identity"
import { HttpError, badRequest, forbidden, notFound } from "../http/errors"
import { newId } from "../ids"
import { open, seal, sha256hex } from "../security/crypto"
import { AUTH_EMAIL_TEMPLATES, openSession, sendAuthEmail, userById, type RequestMeta } from "./identity"
import { limitPerUser } from "./limits"
import { endSessionsForUser } from "./session"
import { consumeToken, failChallenge, peekToken } from "./tokens"
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from "./totp"

/**
 * Admin TOTP (v3). An admin session is only ever created after a TOTP code or a recovery code:
 * password sign-in returns an MFA challenge (auth_tokens purpose mfa_challenge, 10 min, 5 tries),
 * and the challenge is redeemed here. First sign-in enrols (secret → confirm code → recovery codes).
 * Secrets are sealed with the vault, AAD bound to the user; recovery codes are stored as sha256.
 */

const aad = (userId: string) => `admin-totp:${userId}`
const hashRecovery = (code: string) => sha256hex(`yard-recovery|${normalizeRecoveryCode(code)}`)

type ChallengeMeta = { actor?: string; stage?: "verify" | "enrol"; ipHash?: string | null }

async function liveChallenge(token: string, stage: "verify" | "enrol") {
  const row = await peekToken(token, "mfa_challenge")
  const meta = (row?.meta ?? {}) as ChallengeMeta
  if (!row || meta.actor !== "admin") throw badRequest({ challenge: "This sign-in step has expired. Sign in again." }, "This sign-in step has expired. Sign in again.")
  if (meta.stage !== stage) throw new HttpError(409, "conflict", stage === "enrol" ? "Two-step verification is already set up for this account." : "Set up two-step verification first.")
  return row
}

async function mfaRow(userId: string) {
  const d = await db()
  const [row] = await d.select().from(adminMfa).where(eq(adminMfa.userId, userId)).limit(1)
  return row ?? null
}

/**
 * Checks a TOTP code (replay-protected) or a recovery code (single use) for `userId`. Returns
 * which kind matched, or null. Writes go through db() so they join the caller's transaction.
 */
export async function checkSecondFactor(userId: string, input: { code?: string | null; recoveryCode?: string | null }): Promise<"totp" | "recovery" | null> {
  const d = await db()
  if (input.code) {
    const row = await mfaRow(userId)
    if (!row?.enabledAt) return null
    let secret: string
    try {
      secret = open(row.secretEnc, aad(userId))
    } catch {
      return null
    }
    const step = verifyTotp(secret, input.code)
    if (step === null || step <= row.lastStep) return null
    // Compare-and-set on last_step: two parallel uses of the same code can't both pass.
    const [won] = await d
      .update(adminMfa)
      .set({ lastStep: step, updatedAt: new Date() })
      .where(and(eq(adminMfa.userId, userId), sql`${adminMfa.lastStep} < ${step}`))
      .returning({ userId: adminMfa.userId })
    return won ? "totp" : null
  }
  if (input.recoveryCode) {
    const [used] = await d
      .update(mfaRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(mfaRecoveryCodes.userId, userId), eq(mfaRecoveryCodes.codeHash, hashRecovery(input.recoveryCode)), isNull(mfaRecoveryCodes.usedAt)))
      .returning({ id: mfaRecoveryCodes.id })
    return used ? "recovery" : null
  }
  return null
}

async function replaceRecoveryCodes(userId: string) {
  const d = await db()
  const codes = newRecoveryCodes()
  await d.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId))
  await d.insert(mfaRecoveryCodes).values(codes.map((c) => ({ id: newId("rc"), userId, codeHash: hashRecovery(c) })))
  return codes
}

export async function recoveryCodesLeft(userId: string) {
  const d = await db()
  const [r] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(mfaRecoveryCodes)
    .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)))
  return r?.n ?? 0
}

export async function mfaStatus(userId: string) {
  const row = await mfaRow(userId)
  return { enrolled: !!row?.enabledAt, enabledAt: row?.enabledAt?.toISOString() ?? null, recoveryCodesLeft: row?.enabledAt ? await recoveryCodesLeft(userId) : 0 }
}

/** Enrol step 1 (challenge stage 'enrol'): a fresh pending secret. Calling again replaces the pending one. */
export async function startEnrolment(challenge: string, meta: RequestMeta) {
  const row = await liveChallenge(challenge, "enrol")
  await limitPerUser("mfa", row.userId, meta.ipHash)
  const user = await userById(row.userId)
  if (!user) throw notFound()
  const existing = await mfaRow(user.id)
  if (existing?.enabledAt) throw new HttpError(409, "conflict", "Two-step verification is already set up for this account.")
  const secret = newTotpSecret()
  await withTx(async () => {
    const d = await db()
    await d
      .insert(adminMfa)
      .values({ userId: user.id, secretEnc: seal(secret, aad(user.id)), enabledAt: null, lastStep: 0 })
      .onConflictDoUpdate({ target: adminMfa.userId, set: { secretEnc: seal(secret, aad(user.id)), enabledAt: null, lastStep: 0, updatedAt: new Date() } })
  })
  // The secret is shown once, to the person holding a valid challenge (password already checked).
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) }
}

/** Enrol step 2: a code from the app enables TOTP, returns recovery codes (shown once) and opens the admin session. */
export async function confirmEnrolment(challenge: string, code: string, meta: RequestMeta) {
  const row = await liveChallenge(challenge, "enrol")
  await limitPerUser("mfa", row.userId, meta.ipHash)
  const pending = await mfaRow(row.userId)
  if (!pending || pending.enabledAt) throw new HttpError(409, "conflict", "Start setting up two-step verification first.")
  let secret: string
  try {
    secret = open(pending.secretEnc, aad(row.userId))
  } catch {
    throw new HttpError(409, "conflict", "Start setting up two-step verification again.")
  }
  const step = verifyTotp(secret, code)
  if (step === null) {
    const left = await failChallenge(row.id)
    throw badRequest({ code: left ? "That code didn't match. Check your app's clock and try again." : "Too many wrong codes. Sign in again." })
  }
  return withTx(async () => {
    const consumed = await consumeToken(challenge, "mfa_challenge")
    if (!consumed) throw badRequest({ challenge: "This sign-in step has expired. Sign in again." })
    const d = await db()
    await d.update(adminMfa).set({ enabledAt: new Date(), lastStep: step, updatedAt: new Date() }).where(eq(adminMfa.userId, row.userId))
    const codes = await replaceRecoveryCodes(row.userId)
    const user = await userById(row.userId)
    if (!user) throw notFound()
    const [m] = await d.select().from(adminMembers).where(eq(adminMembers.userId, user.id)).limit(1)
    if (!m) throw forbidden("This account isn't a Yard admin.")
    await d.update(adminMembers).set({ mfa: true }).where(eq(adminMembers.userId, user.id))
    await writeAudit({ actor: { kind: "admin", id: user.id, name: user.name, role: m.role }, action: "admin.mfa_enrolled", target: user.name, subjectType: "user", subjectId: user.id, ipHash: meta.ipHash })
    const out = await openSession({ actor: "admin", user, brandId: null, method: "password", mfa: true, meta })
    return { status: "signed_in" as const, actor: "admin" as const, profile: out.profile, recoveryCodes: codes }
  })
}

/** Redeems a 'verify' challenge with a TOTP or recovery code and opens the admin session. */
export async function verifyChallenge(challenge: string, input: { code?: string | null; recoveryCode?: string | null }, meta: RequestMeta) {
  const row = await liveChallenge(challenge, "verify")
  await limitPerUser("mfa", row.userId, meta.ipHash)
  const result = await withTx(async () => {
    const kind = await checkSecondFactor(row.userId, input)
    if (!kind) return null
    const consumed = await consumeToken(challenge, "mfa_challenge")
    if (!consumed) throw badRequest({ challenge: "This sign-in step has expired. Sign in again." })
    const user = await userById(row.userId)
    if (!user || user.status === "suspended") throw forbidden("This account can't sign in.")
    const d = await db()
    const [m] = await d.select().from(adminMembers).where(eq(adminMembers.userId, user.id)).limit(1)
    if (!m) throw forbidden("This account isn't a Yard admin.")
    if (kind === "recovery") await writeAudit({ actor: { kind: "admin", id: user.id, name: user.name, role: m.role }, action: "admin.mfa_recovery_code_used", target: user.name, subjectType: "user", subjectId: user.id, ipHash: meta.ipHash, meta: { left: await recoveryCodesLeft(user.id) } })
    const out = await openSession({ actor: "admin", user, brandId: null, method: "password", mfa: true, meta })
    return { status: "signed_in" as const, actor: "admin" as const, profile: out.profile, recoveryCodesLeft: await recoveryCodesLeft(user.id) }
  })
  if (!result) {
    // Outside the transaction above, so the failed attempt is committed.
    const left = await failChallenge(row.id)
    throw badRequest(input.recoveryCode ? { recoveryCode: left ? "That recovery code isn't valid or was already used." : "Too many wrong codes. Sign in again." } : { code: left ? "That code didn't match. Try the newest code in your app." : "Too many wrong codes. Sign in again." })
  }
  return result
}

/** A signed-in admin replaces their recovery codes (needs a recent re-auth, checked by the route). */
export async function regenerateRecoveryCodes(admin: { userId: string; name: string; role: string }, meta: RequestMeta) {
  return withTx(async () => {
    const row = await mfaRow(admin.userId)
    if (!row?.enabledAt) throw new HttpError(409, "conflict", "Two-step verification isn't set up for this account.")
    const codes = await replaceRecoveryCodes(admin.userId)
    await writeAudit({ actor: { kind: "admin", id: admin.userId, name: admin.name, role: admin.role }, action: "admin.mfa_recovery_codes_regenerated", target: admin.name, subjectType: "user", subjectId: admin.userId, ipHash: meta.ipHash })
    return { recoveryCodes: codes }
  })
}

/**
 * An owner admin resets another admin's TOTP (lost device): deletes the secret and recovery codes
 * and ends that admin's sessions, so their next sign-in enrols again. Never one's own (use recovery codes).
 */
export async function resetAdminMfa(actor: { userId: string; name: string; role: string }, targetUserId: string, reason: string, meta: RequestMeta) {
  if (actor.role !== "owner") throw forbidden("Only an owner can reset another admin's two-step verification.")
  if (actor.userId === targetUserId) throw new HttpError(422, "rule", "You can't reset your own two-step verification. Use a recovery code.")
  return withTx(async (tx) => {
    const d = await db()
    const [m] = await d.select().from(adminMembers).where(eq(adminMembers.userId, targetUserId)).limit(1)
    const target = await userById(targetUserId)
    if (!m || !target) throw notFound("There's no admin with that id.")
    await d.delete(adminMfa).where(eq(adminMfa.userId, targetUserId))
    await d.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, targetUserId))
    await d.update(adminMembers).set({ mfa: false }).where(eq(adminMembers.userId, targetUserId))
    const ended = await endSessionsForUser(targetUserId, ["admin"], "mfa_reset")
    await writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "admin.mfa_reset", target: target.name, subjectType: "user", subjectId: targetUserId, reason, ipHash: meta.ipHash, meta: { endedSessions: ended } })
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.mfaReset, target.email, { name: target.name }, `mfa-reset:${targetUserId}:${Date.now()}`)
    return { ok: true as const }
  })
}

