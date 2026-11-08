import "server-only"
import { createPublicKey, createSign, createVerify, type JsonWebKey, type KeyObject } from "node:crypto"
import { yard } from "../../state"

/**
 * Minimal JOSE for OpenID Connect: verifies RS256/ES256 ID tokens against the provider's JWKS
 * (cached 1 h, refetched once on an unknown `kid`) and signs Apple's ES256 client secret.
 * Fetches happen OUTSIDE any transaction (§1.3).
 */
type Jwk = JsonWebKey & { kid?: string; alg?: string; kty: string }
type JwksCache = Map<string, { at: number; keys: Jwk[] }>

const b64urlJson = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>

function cache(): JwksCache {
  const slots = (yard.slots ??= {})
  return (slots.authJwks ??= new Map()) as JwksCache
}

async function fetchJwks(url: string, force = false): Promise<Jwk[]> {
  const hit = cache().get(url)
  if (!force && hit && Date.now() - hit.at < 3600_000) return hit.keys
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" })
  if (!res.ok) throw new Error(`jwks ${res.status}`)
  const body = (await res.json()) as { keys?: Jwk[] }
  const keys = Array.isArray(body.keys) ? body.keys : []
  cache().set(url, { at: Date.now(), keys })
  return keys
}

export type IdTokenClaims = {
  iss: string
  sub: string
  aud: string | string[]
  exp: number
  iat: number
  nonce?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  given_name?: string
  family_name?: string
  is_private_email?: boolean | string
}

export class IdTokenError extends Error {}

/** Verifies signature, issuer, audience, expiry and nonce. Throws IdTokenError on any mismatch. */
export async function verifyIdToken(idToken: string, opts: { jwksUrl: string; issuers: string[]; audience: string; nonce: string }): Promise<IdTokenClaims> {
  const parts = idToken.split(".")
  if (parts.length !== 3) throw new IdTokenError("malformed")
  const header = b64urlJson(parts[0]) as { alg?: string; kid?: string }
  if (header.alg !== "RS256" && header.alg !== "ES256") throw new IdTokenError("alg")
  let keys = await fetchJwks(opts.jwksUrl)
  let jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) {
    keys = await fetchJwks(opts.jwksUrl, true)
    jwk = keys.find((k) => k.kid === header.kid)
  }
  if (!jwk) throw new IdTokenError("kid")
  let key: KeyObject
  try {
    key = createPublicKey({ key: jwk, format: "jwk" })
  } catch {
    throw new IdTokenError("jwk")
  }
  const v = createVerify("SHA256")
  v.update(`${parts[0]}.${parts[1]}`)
  const sig = Buffer.from(parts[2], "base64url")
  const ok = header.alg === "ES256" ? v.verify({ key, dsaEncoding: "ieee-p1363" }, sig) : v.verify(key, sig)
  if (!ok) throw new IdTokenError("signature")
  const claims = b64urlJson(parts[1]) as unknown as IdTokenClaims
  const now = Math.floor(Date.now() / 1000)
  if (!opts.issuers.includes(claims.iss)) throw new IdTokenError("iss")
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(opts.audience)) throw new IdTokenError("aud")
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new IdTokenError("exp")
  if (typeof claims.iat === "number" && claims.iat > now + 300) throw new IdTokenError("iat")
  if (!claims.sub || typeof claims.sub !== "string") throw new IdTokenError("sub")
  if (claims.nonce !== opts.nonce) throw new IdTokenError("nonce")
  return claims
}

/** An ES256 JWT (Apple's client_secret). */
export function signEs256(payload: Record<string, unknown>, privateKeyPem: string, kid: string) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const input = `${enc({ alg: "ES256", kid, typ: "JWT" })}.${enc(payload)}`
  const s = createSign("SHA256")
  s.update(input)
  const sig = s.sign({ key: privateKeyPem, dsaEncoding: "ieee-p1363" }).toString("base64url")
  return `${input}.${sig}`
}

export const truthy = (v: unknown) => v === true || v === "true"
