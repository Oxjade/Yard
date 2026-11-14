/**
 * Native app sign-in hand-off: pure helpers (no database, no network, no "server-only"), so
 * `tsx --test` unit-tests them (app-core.test.ts). The flow itself is in flow.ts.
 *
 * Google refuses OAuth inside embedded WebViews, so the Android (and later iOS) app signs in
 * through a Custom Tab, whose cookies aren't the app's. The app makes a random verifier and sends
 * challenge = base64url(sha256(verifier)) to GET /api/auth/oauth/{provider}/app-start. The callback
 * of such a flow opens no session; it stores a single-use hand-off code (sha256 only, 120 s) and
 * redirects to yard://auth/complete?code=…. The app then POSTs { code, verifier } to
 * /api/auth/oauth/app-exchange, which opens the session in the app's own cookie jar. A code that
 * leaks to another app on the phone is useless without the verifier, which never left the app.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

export const APP_CLIENT_IDS = ["android", "ios"] as const
export type AppClient = (typeof APP_CLIENT_IDS)[number]

/** The app's own scheme: where every app flow ends, success or not. */
export const APP_COMPLETE_URL = "yard://auth/complete"

/** A hand-off code lives this long (the app exchanges it straight away). */
export const HANDOFF_TTL_MS = 120_000

/** base64url of a SHA-256 digest: exactly 43 characters, no padding. */
export const APP_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/
/** RFC 7636 verifier alphabet and length (the app sends base64url of 32 random bytes: 43 chars). */
export const APP_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/
/** A hand-off code: base64url of 32 random bytes. */
export const APP_CODE_RE = /^[A-Za-z0-9_-]{43}$/

export const isAppClient = (v: unknown): v is AppClient => v === "android" || v === "ios"

export const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url")

/** True when sha256(verifier) is the stored challenge (constant time). */
export function verifierMatches(verifier: string, challenge: string) {
  if (!APP_VERIFIER_RE.test(verifier) || !APP_CHALLENGE_RE.test(challenge)) return false
  const a = Buffer.from(challengeOf(verifier))
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** A new hand-off code and the hash that is stored (the code itself is never stored). */
export function newHandoffCode() {
  const code = randomBytes(32).toString("base64url")
  return { code, hash: hashHandoffCode(code) }
}

export const hashHandoffCode = (code: string) => createHash("sha256").update(code).digest("hex")

/**
 * yard://auth/complete?… Success carries code, result, provider, mode and actor; a failure only
 * result and provider (no code).
 */
export function appCompleteUrl(p: { result: string; provider?: string | null; code?: string | null; mode?: string | null; actor?: string | null }) {
  const q = new URLSearchParams()
  if (p.code) q.set("code", p.code)
  q.set("result", p.result)
  if (p.provider) q.set("provider", p.provider)
  if (p.code) {
    if (p.mode) q.set("mode", p.mode)
    if (p.actor) q.set("actor", p.actor)
  }
  return `${APP_COMPLETE_URL}?${q.toString()}`
}
