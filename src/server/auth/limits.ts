import "server-only"
import { getEnv } from "../env"
import { rateLimited } from "../http/errors"
import { sha256hex } from "../security/crypto"
import { hit, recordAbuse } from "../security/rate-limit"
import { yard } from "../state"

/**
 * Sign-in rate limits (§5.1 pattern): per client IP (one global bucket when the IP is unknown)
 * and per email address whether or not an account exists, so the answers never say which emails
 * have accounts. Durable per-account lockout lives in user_credentials (identity.ts).
 */
export const LIMITS = {
  signInPerIp: { limit: 30, windowSec: 600 },
  signInGlobalUnknownIp: { limit: 600, windowSec: 600 },
  signInPerEmail: { limit: 10, windowSec: 900 },
  emailSendPerIp: { limit: 10, windowSec: 3600 },
  emailSendPerEmail: { limit: 3, windowSec: 3600 },
  emailSendGlobalUnknownIp: { limit: 300, windowSec: 3600 },
  tokenConsumePerIp: { limit: 30, windowSec: 600 },
  mfaPerUser: { limit: 10, windowSec: 600 },
  // Control Center (admin) sign-in is stricter than shoppers' and brands', on top of the buckets above.
  adminSignInPerIp: { limit: 10, windowSec: 900 },
  adminSignInGlobalUnknownIp: { limit: 100, windowSec: 900 },
  adminSignInPerEmail: { limit: 5, windowSec: 900 },
  // Authenticator / recovery-code attempts (enrol, enrol confirm, verify) per client IP. Admin only.
  adminMfaPerIp: { limit: 10, windowSec: 900 },
  adminMfaGlobalUnknownIp: { limit: 100, windowSec: 900 },
  reauthPerUser: { limit: 10, windowSec: 600 },
  oauthStartPerIp: { limit: 30, windowSec: 600 },
  invitesPerBrandDay: { limit: 50, windowSec: 86_400 },
} as const

/** Durable lockout: this many wrong passwords within the window locks the account for LOCK_MIN. */
export const LOCKOUT = { failures: 10, windowMin: 15, lockMin: 15 }

export const emailKey = (email: string) => sha256hex(`auth-email|${email.trim().toLowerCase()}`).slice(0, 24)

async function check(key: string, limit: number, windowSec: number, action: string, ipHash: string | null, message: string) {
  const r = hit(key, limit, windowSec)
  if (!r.ok) {
    await recordAbuse(key, { kind: "anon", id: null, ipHash }, action, "rate_limit", { limit, windowSec }).catch(() => {})
    throw rateLimited(r.retryAfter, message)
  }
}

const tooMany = "Too many attempts. Try again in a few minutes, or reset your password."

const adminTooMany = "Too many sign-in attempts. Wait 15 minutes and try again."

/**
 * Password sign-in: per IP (or the global unknown-IP bucket) and per email. A Control Center
 * (actor "admin") attempt also spends the tighter admin buckets.
 */
export async function limitSignIn(email: string, ipHash: string | null, actor?: string) {
  // In development the curl kit and parallel tabs share loopback: keep the per-IP budget roomy.
  const dev = getEnv().dev
  if (ipHash) await check(`auth.signin:ip:${ipHash}`, dev ? 120 : LIMITS.signInPerIp.limit, LIMITS.signInPerIp.windowSec, "auth.signin", ipHash, tooMany)
  else await check("auth.signin:anon-global", LIMITS.signInGlobalUnknownIp.limit, LIMITS.signInGlobalUnknownIp.windowSec, "auth.signin", null, tooMany)
  await check(`auth.signin:email:${emailKey(email)}`, LIMITS.signInPerEmail.limit, LIMITS.signInPerEmail.windowSec, "auth.signin", ipHash, tooMany)
  if (actor !== "admin") return
  if (ipHash) await check(`auth.admin-signin:ip:${ipHash}`, dev ? 60 : LIMITS.adminSignInPerIp.limit, LIMITS.adminSignInPerIp.windowSec, "auth.admin_signin", ipHash, adminTooMany)
  else await check("auth.admin-signin:anon-global", LIMITS.adminSignInGlobalUnknownIp.limit, LIMITS.adminSignInGlobalUnknownIp.windowSec, "auth.admin_signin", null, adminTooMany)
  await check(`auth.admin-signin:email:${emailKey(email)}`, dev ? 30 : LIMITS.adminSignInPerEmail.limit, LIMITS.adminSignInPerEmail.windowSec, "auth.admin_signin", ipHash, adminTooMany)
}

/**
 * Forgets the per-email sign-in window. A password reset proves the address and clears the
 * durable lockout; without this the in-memory per-email window (which counts the wrong guesses
 * that caused the lockout) would keep answering 429 "…or reset your password" for up to 15
 * minutes after the person did exactly that.
 */
export function clearSignInEmailLimit(email: string) {
  const windows = (yard.limiter as { windows?: Map<string, unknown> } | undefined)?.windows
  windows?.delete(`auth.signin:email:${emailKey(email)}`)
  windows?.delete(`auth.admin-signin:email:${emailKey(email)}`)
}

/** Anything that sends an email to an address the caller typed (verify, reset, magic link, sign-up). */
export async function limitEmailSend(action: string, email: string, ipHash: string | null) {
  const msg = "We've sent a few emails already. Check your inbox, or try again in an hour."
  if (ipHash) await check(`auth.mail:${action}:ip:${ipHash}`, LIMITS.emailSendPerIp.limit, LIMITS.emailSendPerIp.windowSec, `auth.${action}`, ipHash, msg)
  else await check(`auth.mail:${action}:anon-global`, LIMITS.emailSendGlobalUnknownIp.limit, LIMITS.emailSendGlobalUnknownIp.windowSec, `auth.${action}`, null, msg)
  await check(`auth.mail:${action}:email:${emailKey(email)}`, LIMITS.emailSendPerEmail.limit, LIMITS.emailSendPerEmail.windowSec, `auth.${action}`, ipHash, msg)
}

export async function limitTokenConsume(action: string, ipHash: string | null) {
  await check(`auth.token:${action}:${ipHash ?? "anon-global"}`, ipHash ? LIMITS.tokenConsumePerIp.limit : LIMITS.tokenConsumePerIp.limit * 20, LIMITS.tokenConsumePerIp.windowSec, `auth.${action}`, ipHash, "Too many attempts. Try again in a few minutes.")
}

export async function limitPerUser(action: "mfa" | "reauth", userId: string, ipHash: string | null) {
  const l = action === "mfa" ? LIMITS.mfaPerUser : LIMITS.reauthPerUser
  const msg = "Too many codes tried. Wait a few minutes and try again."
  // Second-factor challenges exist only for admins (mfa.ts): also cap them per client IP, so one
  // address can't spread code guesses across several admin accounts.
  if (action === "mfa") {
    if (ipHash) await check(`auth.admin-mfa:ip:${ipHash}`, getEnv().dev ? 60 : LIMITS.adminMfaPerIp.limit, LIMITS.adminMfaPerIp.windowSec, "auth.admin_mfa", ipHash, msg)
    else await check("auth.admin-mfa:anon-global", LIMITS.adminMfaGlobalUnknownIp.limit, LIMITS.adminMfaGlobalUnknownIp.windowSec, "auth.admin_mfa", null, msg)
  }
  await check(`auth.${action}:user:${userId}`, l.limit, l.windowSec, `auth.${action}`, ipHash, msg)
}

export async function limitOauthStart(ipHash: string | null) {
  await check(`auth.oauth:${ipHash ?? "anon-global"}`, ipHash ? LIMITS.oauthStartPerIp.limit : LIMITS.oauthStartPerIp.limit * 20, LIMITS.oauthStartPerIp.windowSec, "auth.oauth", ipHash, "Too many sign-in attempts. Try again in a few minutes.")
}
