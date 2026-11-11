import "server-only"
import { hkdfSync } from "node:crypto"
import { getEnv } from "../env"
import { yard } from "../state"

/**
 * AUTH configuration read lazily from process.env (src/server/env.ts is F1's; these names are
 * the v3 brief's). A provider with missing keys is "not configured": its start route answers
 * 503 not_configured and the UI should hide the button (GET /api/auth/providers). Nothing is faked.
 */
export type AuthEnv = {
  google: { clientId: string; clientSecret: string } | null
  apple: { clientId: string; teamId: string; keyId: string; privateKey: string } | null
}

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : null)

export function authEnv(): AuthEnv {
  const slots = (yard.slots ??= {})
  return (slots.authEnv ??= (() => {
    const gId = blank(process.env.GOOGLE_CLIENT_ID)
    const gSecret = blank(process.env.GOOGLE_CLIENT_SECRET)
    const aId = blank(process.env.APPLE_CLIENT_ID)
    const aTeam = blank(process.env.APPLE_TEAM_ID)
    const aKey = blank(process.env.APPLE_KEY_ID)
    // A PEM pasted into a one-line env var usually arrives with literal "\n".
    const aPem = blank(process.env.APPLE_PRIVATE_KEY)?.replace(/\\n/g, "\n") ?? null
    return {
      google: gId && gSecret ? { clientId: gId, clientSecret: gSecret } : null,
      apple: aId && aTeam && aKey && aPem ? { clientId: aId, teamId: aTeam, keyId: aKey, privateKey: aPem } : null,
    } satisfies AuthEnv
  })()) as AuthEnv
}

/** HKDF subkeys for AUTH, derived from YARD_SESSION_SECRET with their own labels (no key does two jobs). */
export type AuthKeys = { oauthState: Buffer; oauthBinding: Buffer; challenge: Buffer }

export function authKeys(): AuthKeys {
  const slots = (yard.slots ??= {})
  return (slots.authKeys ??= (() => {
    const ikm = getEnv().sessionSecret
    const derive = (info: string) => Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), info, 32))
    return { oauthState: derive("yard/auth-oauth-state/v1"), oauthBinding: derive("yard/auth-oauth-binding/v1"), challenge: derive("yard/auth-challenge/v1") } satisfies AuthKeys
  })()) as AuthKeys
}

/** Where the browser lands after an OAuth round trip; the frontend page reads `result`. */
export const AUTH_COMPLETE_PATH = "/auth/complete"

/** Frontend pages that read a `token` query parameter and POST it back (no GET ever writes). */
export const authLinks = {
  verifyEmail: (token: string) => `${getEnv().publicUrl}/auth/verify?token=${encodeURIComponent(token)}`,
  resetPassword: (token: string) => `${getEnv().publicUrl}/auth/reset?token=${encodeURIComponent(token)}`,
  magicLink: (token: string) => `${getEnv().publicUrl}/auth/magic?token=${encodeURIComponent(token)}`,
  invite: (token: string) => `${getEnv().publicUrl}/auth/invite?token=${encodeURIComponent(token)}`,
  claim: (token: string) => `${getEnv().publicUrl}/auth/claim?token=${encodeURIComponent(token)}`,
}

export const oauthRedirectUri = (provider: "google" | "apple") => `${getEnv().publicUrl}/api/auth/oauth/${provider}/callback`
