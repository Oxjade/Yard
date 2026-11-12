import "server-only"
import { authEnv, oauthRedirectUri } from "../auth-env"
import { signEs256, truthy, verifyIdToken } from "./jwt"

/**
 * Sign-in providers behind one interface. `live` implementations read keys from env; when keys
 * are absent the provider is the `stub`, which is honest: configured=false, and every call
 * throws ProviderNotConfigured (the routes answer 503 not_configured). It never pretends to sign
 * anyone in.
 */
export type ProviderId = "google" | "apple" | "auth0"

export type ProviderProfile = { subject: string; email: string | null; emailVerified: boolean; name: string | null }

export interface SignInProvider {
  id: ProviderId
  impl: "live" | "stub"
  configured: boolean
  /** The authorize URL for this round trip. */
  authorizeUrl(input: { state: string; nonce: string; codeChallenge: string | null; connection?: string | null }): string
  /** Code → verified profile (network I/O; never inside a transaction). */
  exchange(input: { code: string; codeVerifier: string | null; nonce: string; appleUser?: string | null }): Promise<ProviderProfile>
  usesPkce: boolean
}

export class ProviderNotConfigured extends Error {
  constructor(public provider: ProviderId) {
    super(`${provider} sign-in is not configured`)
  }
}

const label: Record<ProviderId, string> = { google: "Google", apple: "Apple", auth0: "Auth0" }
export const providerLabel = (p: ProviderId) => label[p]

function stub(id: ProviderId): SignInProvider {
  return {
    id,
    impl: "stub",
    configured: false,
    usesPkce: false,
    authorizeUrl() {
      throw new ProviderNotConfigured(id)
    },
    async exchange() {
      throw new ProviderNotConfigured(id)
    },
  }
}

async function postForm(url: string, form: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  })
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string }
  // Never log the body: it holds tokens. Only the status and the provider's error code.
  if (!res.ok || !body.id_token) throw new Error(`token exchange failed: ${res.status} ${typeof body.error === "string" ? body.error.slice(0, 40) : ""}`)
  return body.id_token
}

function google(cfg: { clientId: string; clientSecret: string }): SignInProvider {
  return {
    id: "google",
    impl: "live",
    configured: true,
    usesPkce: true,
    authorizeUrl({ state, nonce, codeChallenge }) {
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth")
      u.searchParams.set("client_id", cfg.clientId)
      u.searchParams.set("redirect_uri", oauthRedirectUri("google"))
      u.searchParams.set("response_type", "code")
      u.searchParams.set("scope", "openid email profile")
      u.searchParams.set("state", state)
      u.searchParams.set("nonce", nonce)
      u.searchParams.set("prompt", "select_account")
      if (codeChallenge) {
        u.searchParams.set("code_challenge", codeChallenge)
        u.searchParams.set("code_challenge_method", "S256")
      }
      return u.toString()
    },
    async exchange({ code, codeVerifier, nonce }) {
      const idToken = await postForm("https://oauth2.googleapis.com/token", {
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: oauthRedirectUri("google"),
        grant_type: "authorization_code",
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      })
      const c = await verifyIdToken(idToken, { jwksUrl: "https://www.googleapis.com/oauth2/v3/certs", issuers: ["https://accounts.google.com", "accounts.google.com"], audience: cfg.clientId, nonce })
      return { subject: c.sub, email: c.email?.toLowerCase() ?? null, emailVerified: truthy(c.email_verified), name: c.name ?? null }
    },
  }
}

function apple(cfg: { clientId: string; teamId: string; keyId: string; privateKey: string }): SignInProvider {
  const clientSecret = () => {
    const now = Math.floor(Date.now() / 1000)
    return signEs256({ iss: cfg.teamId, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: cfg.clientId }, cfg.privateKey, cfg.keyId)
  }
  return {
    id: "apple",
    impl: "live",
    configured: true,
    // Apple's documented web flow is state + nonce with a signed client secret.
    usesPkce: false,
    authorizeUrl({ state, nonce }) {
      const u = new URL("https://appleid.apple.com/auth/authorize")
      u.searchParams.set("client_id", cfg.clientId)
      u.searchParams.set("redirect_uri", oauthRedirectUri("apple"))
      u.searchParams.set("response_type", "code")
      // name/email scopes require form_post: the callback route accepts POST and re-enters as GET.
      u.searchParams.set("response_mode", "form_post")
      u.searchParams.set("scope", "name email")
      u.searchParams.set("state", state)
      u.searchParams.set("nonce", nonce)
      return u.toString()
    },
    async exchange({ code, nonce, appleUser }) {
      const idToken = await postForm("https://appleid.apple.com/auth/token", {
        code,
        client_id: cfg.clientId,
        client_secret: clientSecret(),
        redirect_uri: oauthRedirectUri("apple"),
        grant_type: "authorization_code",
      })
      const c = await verifyIdToken(idToken, { jwksUrl: "https://appleid.apple.com/auth/keys", issuers: ["https://appleid.apple.com"], audience: cfg.clientId, nonce })
      // Apple sends the name only on the first authorization, in the form post's `user` JSON.
      let name: string | null = null
      if (appleUser) {
        try {
          const u = JSON.parse(appleUser) as { name?: { firstName?: string; lastName?: string } }
          name = [u.name?.firstName, u.name?.lastName].filter((x) => typeof x === "string" && x.trim()).join(" ").slice(0, 80) || null
        } catch {
          name = null
        }
      }
      return { subject: c.sub, email: c.email?.toLowerCase() ?? null, emailVerified: truthy(c.email_verified), name }
    },
  }
}

/**
 * Auth0 as a generic OIDC provider: code + PKCE + state/nonce, `connection` picks the social
 * connection (Google, Facebook, …) so the button goes straight there. The ID token is verified
 * against the tenant's JWKS; issuer is "{issuerBase}/". Only verified emails are accepted
 * (the flow refuses `email_verified` false or missing with result email_unverified).
 */
function auth0(cfg: NonNullable<ReturnType<typeof authEnv>["auth0"]>): SignInProvider {
  const allowed = new Set(cfg.connections.map((c) => c.name))
  return {
    id: "auth0",
    impl: "live",
    configured: true,
    usesPkce: true,
    authorizeUrl({ state, nonce, codeChallenge, connection }) {
      const u = new URL(`${cfg.issuerBase}/authorize`)
      u.searchParams.set("client_id", cfg.clientId)
      u.searchParams.set("redirect_uri", oauthRedirectUri("auth0"))
      u.searchParams.set("response_type", "code")
      u.searchParams.set("scope", "openid email profile")
      u.searchParams.set("state", state)
      u.searchParams.set("nonce", nonce)
      if (connection && allowed.has(connection)) u.searchParams.set("connection", connection)
      if (codeChallenge) {
        u.searchParams.set("code_challenge", codeChallenge)
        u.searchParams.set("code_challenge_method", "S256")
      }
      return u.toString()
    },
    async exchange({ code, codeVerifier, nonce }) {
      const idToken = await postForm(`${cfg.issuerBase}/oauth/token`, {
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: oauthRedirectUri("auth0"),
        grant_type: "authorization_code",
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      })
      const c = await verifyIdToken(idToken, { jwksUrl: `${cfg.issuerBase}/.well-known/jwks.json`, issuers: [`${cfg.issuerBase}/`], audience: cfg.clientId, nonce })
      return { subject: c.sub, email: c.email?.toLowerCase() ?? null, emailVerified: truthy(c.email_verified), name: c.name ?? null }
    },
  }
}

export function getProvider(id: ProviderId): SignInProvider {
  const env = authEnv()
  if (id === "google") return env.google ? google(env.google) : stub("google")
  if (id === "auth0") return env.auth0 ? auth0(env.auth0) : stub("auth0")
  return env.apple ? apple(env.apple) : stub("apple")
}

/** The Auth0 connections offered as buttons (empty when Auth0 isn't configured). */
export const auth0Connections = () => authEnv().auth0?.connections ?? []

export const providerStatus = () => ({ google: getProvider("google").configured, apple: getProvider("apple").configured, auth0: getProvider("auth0").configured })
