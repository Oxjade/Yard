import "server-only"
import { hkdfSync } from "node:crypto"
import { auth0IssuerBase, normaliseAuth0Domain, parseAuth0Connections, type Auth0Connection } from "../../lib/auth/auth0"
import { getEnv } from "../env"
import { log } from "../log"
import { yard } from "../state"

/**
 * AUTH configuration read lazily from process.env (src/server/env.ts is F1's; these names are
 * the v3 brief's). A provider with missing keys is "not configured": its start route answers
 * 503 not_configured and the UI should hide the button (GET /api/auth/providers). Nothing is faked.
 */
export type AuthEnv = {
  google: { clientId: string; clientSecret: string } | null
  apple: { clientId: string; teamId: string; keyId: string; privateKey: string } | null
  /** Auth0 (generic OIDC). `issuerBase` is https://{domain} unless AUTH0_ISSUER_BASE overrides it (tests/dev). */
  auth0: { domain: string; issuerBase: string; clientId: string; clientSecret: string; connections: Auth0Connection[] } | null
}

/** AUTH0_* → config, or null with the reasons it isn't usable (logged once; the button stays hidden). */
export function readAuth0Env(e: NodeJS.ProcessEnv, production: boolean): { config: AuthEnv["auth0"]; problems: string[] } {
  const rawDomain = blank(e.AUTH0_DOMAIN)
  const id = blank(e.AUTH0_CLIENT_ID)
  const secret = blank(e.AUTH0_CLIENT_SECRET)
  if (!rawDomain && !id && !secret) return { config: null, problems: [] }
  const problems: string[] = []
  const domain = normaliseAuth0Domain(rawDomain)
  if (!rawDomain) problems.push("AUTH0_DOMAIN is missing")
  else if (!domain) problems.push("AUTH0_DOMAIN must be a host name such as tenant.us.auth0.com (no path)")
  if (!id) problems.push("AUTH0_CLIENT_ID is missing")
  if (!secret) problems.push("AUTH0_CLIENT_SECRET is missing")
  const { connections, invalid } = parseAuth0Connections(e.AUTH0_CONNECTIONS)
  if (invalid.length) problems.push(`AUTH0_CONNECTIONS has invalid names: ${invalid.join(", ").slice(0, 120)}`)
  if (!connections.length) problems.push("AUTH0_CONNECTIONS lists no connections")
  let issuerBase: string | null = null
  if (domain) {
    const b = auth0IssuerBase(domain, e.AUTH0_ISSUER_BASE, production)
    if ("error" in b) problems.push(b.error)
    else issuerBase = b.base
  }
  if (problems.length || !domain || !id || !secret || !issuerBase) return { config: null, problems }
  return { config: { domain, issuerBase, clientId: id, clientSecret: secret, connections }, problems }
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
    const a0 = readAuth0Env(process.env, !getEnv().dev)
    if (a0.problems.length) log.once("env:auth0", "warn", `[yard] Auth0 sign-in is off: ${a0.problems.join("; ")}`)
    return {
      auth0: a0.config,
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
  changeEmail: (token: string) => `${getEnv().publicUrl}/auth/change-email?token=${encodeURIComponent(token)}`,
}

export const oauthRedirectUri = (provider: "google" | "apple" | "auth0") => `${getEnv().publicUrl}/api/auth/oauth/${provider}/callback`
