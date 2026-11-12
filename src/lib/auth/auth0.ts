/**
 * Auth0 as one OpenID Connect provider ("auth0") that fronts several social connections
 * (Google, Facebook, Apple, …). Plain module (no server-only): the server parses env with it, the
 * sign-in surfaces label buttons with it, and `tsx --test` loads it.
 */

/** Auth0's own connection names → the word on the button. Anything else is capitalised. */
const KNOWN: Record<string, string> = {
  "google-oauth2": "Google",
  facebook: "Facebook",
  apple: "Apple",
  twitter: "X",
  windowslive: "Microsoft",
  linkedin: "LinkedIn",
  github: "GitHub",
}

export const DEFAULT_AUTH0_CONNECTIONS = "google-oauth2"

/** Connection names are Auth0 identifiers: letters, digits, dashes and underscores. */
const CONNECTION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export type Auth0Connection = { name: string; label: string }

export function auth0ConnectionLabel(name: string): string {
  const known = KNOWN[name]
  if (known) return known
  const words = name.split(/[-_]+/).filter(Boolean)
  if (!words.length) return name
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

/** "google-oauth2, facebook" → [{ name, label }]; blank → the default; invalid names are reported. */
export function parseAuth0Connections(raw: string | undefined | null): { connections: Auth0Connection[]; invalid: string[] } {
  const src = raw && raw.trim() ? raw : DEFAULT_AUTH0_CONNECTIONS
  const seen = new Set<string>()
  const connections: Auth0Connection[] = []
  const invalid: string[] = []
  for (const part of src.split(",")) {
    const name = part.trim()
    if (!name) continue
    if (!CONNECTION.test(name)) {
      invalid.push(name)
      continue
    }
    if (seen.has(name)) continue
    seen.add(name)
    connections.push({ name, label: auth0ConnectionLabel(name) })
  }
  return { connections, invalid }
}

/**
 * AUTH0_DOMAIN as a bare host ("tenant.us.auth0.com"). Accepts a pasted "https://…/" and strips
 * it; returns null for anything that isn't a hostname.
 */
export function normaliseAuth0Domain(raw: string | undefined | null): string | null {
  if (!raw || !raw.trim()) return null
  const host = raw
    .trim()
    .replace(/^https:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase()
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) ? host : null
}

/**
 * The issuer base for authorize/token/JWKS URLs: https://{domain}, or AUTH0_ISSUER_BASE (tests
 * and local development against a mock server). An override over http:// is accepted only for
 * localhost / 127.0.0.1 and only outside production. Returns the base without a trailing slash,
 * or an error string.
 */
export function auth0IssuerBase(domain: string, override: string | undefined | null, production: boolean): { base: string } | { error: string } {
  if (!override || !override.trim()) return { base: `https://${domain}` }
  let u: URL
  try {
    u = new URL(override.trim())
  } catch {
    return { error: "AUTH0_ISSUER_BASE must be a URL" }
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1"
  if (u.protocol === "https:") return { base: u.origin + u.pathname.replace(/\/+$/, "") }
  if (u.protocol === "http:" && local && !production) return { base: u.origin + u.pathname.replace(/\/+$/, "") }
  return { error: "AUTH0_ISSUER_BASE must be https:// (http://localhost only outside production)" }
}

/** "google-oauth2|1234" → "google-oauth2". The connection part of an Auth0 `sub`. */
export const auth0ConnectionOfSubject = (sub: string) => {
  const i = sub.indexOf("|")
  return i > 0 ? sub.slice(0, i) : sub
}

/**
 * Auth0 `sub` prefixes are the identity-provider strategy, which for the built-in social
 * connections equals the connection name ("google-oauth2|…", "facebook|…", "apple|…").
 */
export const auth0SubjectLabel = (sub: string) => auth0ConnectionLabel(auth0ConnectionOfSubject(sub))

/** The sign-in buttons a surface shows, from GET /api/auth/providers. */
export type ProvidersStatus = { google: boolean; apple: boolean; auth0?: boolean; auth0Connections?: Auth0Connection[] }
export type SocialButton = { key: string; provider: "google" | "apple" | "auth0"; connection: string | null; label: string; mark: "google" | "apple" | "generic" }

/**
 * Direct Google / Apple first, then one button per Auth0 connection. A connection that duplicates
 * a configured direct provider (google-oauth2 when Google keys are set, apple when Apple's are) is
 * dropped so there is only one Google (or Apple) button, and the direct one wins.
 */
export function socialButtons(p: ProvidersStatus | null | undefined): SocialButton[] {
  if (!p) return []
  const out: SocialButton[] = []
  if (p.google) out.push({ key: "google", provider: "google", connection: null, label: "Google", mark: "google" })
  if (p.apple) out.push({ key: "apple", provider: "apple", connection: null, label: "Apple", mark: "apple" })
  if (p.auth0) {
    for (const c of p.auth0Connections ?? []) {
      if (c.name === "google-oauth2" && p.google) continue
      if (c.name === "apple" && p.apple) continue
      out.push({ key: `auth0:${c.name}`, provider: "auth0", connection: c.name, label: c.label, mark: c.name === "google-oauth2" ? "google" : c.name === "apple" ? "apple" : "generic" })
    }
  }
  return out
}

/**
 * Re-auth methods as the server names them (`fields.reauthWith`): "google", "apple" or
 * "auth0:<connection>", comma-separated. Parsed into buttons the same way.
 */
export type ReauthProvider = { key: string; provider: "google" | "apple" | "auth0"; connection: string | null; label: string }

export function parseReauthProviders(v: string | undefined | null): ReauthProvider[] {
  const out: ReauthProvider[] = []
  const seen = new Set<string>()
  for (const raw of (v ?? "").split(",")) {
    const p = raw.trim()
    if (!p || seen.has(p)) continue
    if (p === "google" || p === "apple") {
      seen.add(p)
      out.push({ key: p, provider: p, connection: null, label: p === "apple" ? "Apple" : "Google" })
    } else if (p.startsWith("auth0:")) {
      const c = p.slice(6)
      if (!CONNECTION.test(c)) continue
      seen.add(p)
      out.push({ key: p, provider: "auth0", connection: c, label: auth0ConnectionLabel(c) })
    }
  }
  return out
}
