import { createSign } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { AndroidConfig } from "./config"

/**
 * Android: Google Play Integrity, standard requests (docs/APP.md "App attestation"). The app asks
 * Play for a token bound to the request's requestHash; the server decodes it with Google's
 * decodeIntegrityToken endpoint, authenticated as the Cloud project's service account, and checks
 * the verdict. No server-only import, so `tsx --test` loads the verdict rules.
 */

/** The decoded payload (tokenPayloadExternal). Only the fields Yard checks. */
export type PlayPayload = {
  requestDetails?: { requestPackageName?: string; requestHash?: string; nonce?: string; timestampMillis?: string | number }
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[]; versionCode?: string }
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] }
  accountDetails?: { appLicensingVerdict?: string }
}

/** A token older than this (or this far in the future) is refused. */
export const PLAY_MAX_AGE_MS = 5 * 60_000

/** The verdict rules: recognised app, our package and signing certificate, a genuine device, this request, fresh. */
export function checkPlayVerdict(p: PlayPayload, cfg: Pick<AndroidConfig, "packageName" | "certDigests">, requestHash: string, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  const rd = p.requestDetails
  if (!rd) return { ok: false, reason: "no_request_details" }
  if (rd.requestPackageName !== cfg.packageName) return { ok: false, reason: "request_package" }
  if (!rd.requestHash || rd.requestHash !== requestHash) return { ok: false, reason: "request_hash" }
  const ts = Number(rd.timestampMillis)
  if (!Number.isFinite(ts) || now - ts > PLAY_MAX_AGE_MS || ts - now > PLAY_MAX_AGE_MS) return { ok: false, reason: "stale" }
  const app = p.appIntegrity
  if (app?.appRecognitionVerdict !== "PLAY_RECOGNIZED") return { ok: false, reason: `app_${(app?.appRecognitionVerdict ?? "missing").toLowerCase()}` }
  if (app.packageName !== cfg.packageName) return { ok: false, reason: "app_package" }
  const digests = (app.certificateSha256Digest ?? []).map((d) => d.replace(/=+$/, ""))
  if (!digests.some((d) => cfg.certDigests.includes(d))) return { ok: false, reason: "certificate" }
  if (!(p.deviceIntegrity?.deviceRecognitionVerdict ?? []).includes("MEETS_DEVICE_INTEGRITY")) return { ok: false, reason: "device" }
  return { ok: true }
}

/* ---------- Google APIs (service account → access token → decodeIntegrityToken) ---------- */

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string }
type Fetch = typeof fetch

const SCOPE = "https://www.googleapis.com/auth/playintegrity"
let cached: { path: string; token: string; expiresAt: number } | null = null

async function readServiceAccount(path: string): Promise<ServiceAccount> {
  const sa = JSON.parse(await readFile(path, "utf8")) as Partial<ServiceAccount>
  if (!sa.client_email || !sa.private_key) throw new Error("The Play Integrity service account file has no client_email or private_key.")
  return sa as ServiceAccount
}

/** An OAuth access token for the service account (JWT bearer grant), cached until a minute before it expires. */
async function accessToken(path: string, fetchImpl: Fetch, now = Date.now()): Promise<string> {
  if (cached && cached.path === path && cached.expiresAt - 60_000 > now) return cached.token
  const sa = await readServiceAccount(path)
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token"
  const iat = Math.floor(now / 1000)
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: sa.client_email, scope: SCOPE, aud, iat, exp: iat + 3600 })}`
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url")
  const res = await fetchImpl(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new GoogleUnavailable(`token endpoint answered ${res.status}`)
  const out = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!out.access_token) throw new GoogleUnavailable("token endpoint returned no access_token")
  cached = { path, token: out.access_token, expiresAt: now + (out.expires_in ?? 3600) * 1000 }
  return out.access_token
}

/** Google could not be reached or answered with a server error: the request is allowed (logged). */
export class GoogleUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GoogleUnavailable"
  }
}

/**
 * Decodes a token with Google. Returns the payload, or null when Google refuses the token itself
 * (4xx: malformed, for another app, expired). Throws GoogleUnavailable on a network or 5xx error.
 */
export async function decodeIntegrityToken(token: string, cfg: Pick<AndroidConfig, "packageName" | "credentialsPath">, fetchImpl: Fetch = fetch): Promise<PlayPayload | null> {
  let bearer: string
  try {
    bearer = await accessToken(cfg.credentialsPath, fetchImpl)
  } catch (e) {
    if (e instanceof GoogleUnavailable) throw e
    throw new GoogleUnavailable(e instanceof Error ? e.message : "access token failed")
  }
  let res: Response
  try {
    res = await fetchImpl(`https://playintegrity.googleapis.com/v1/${encodeURIComponent(cfg.packageName)}:decodeIntegrityToken`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ integrity_token: token }),
      signal: AbortSignal.timeout(8000),
    })
  } catch (e) {
    throw new GoogleUnavailable(e instanceof Error ? e.message : "network error")
  }
  if (res.status === 401 || res.status === 403) {
    cached = null
    throw new GoogleUnavailable(`decodeIntegrityToken answered ${res.status} (check the service account's access in Play Console)`)
  }
  if (res.status >= 500 || res.status === 429) throw new GoogleUnavailable(`decodeIntegrityToken answered ${res.status}`)
  if (!res.ok) return null
  const out = (await res.json()) as { tokenPayloadExternal?: PlayPayload }
  return out.tokenPayloadExternal ?? null
}
