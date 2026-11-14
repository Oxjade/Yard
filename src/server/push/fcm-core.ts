/**
 * Firebase Cloud Messaging (HTTP v1) pure helpers: the service account, the OAuth2 JWT and the
 * message body. No database, no network and no "server-only", so `tsx --test` unit-tests them
 * (fcm-core.test.ts). Sending is in index.ts. No SDK: a JWT signed with node:crypto (RS256) is
 * exchanged at Google's token endpoint for an access token.
 */
import { createSign } from "node:crypto"

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
/** The Android notification channel the app creates (and the brand yellow for the small icon). */
export const ANDROID_CHANNEL_ID = "yard_updates"
export const ANDROID_COLOR = "#F5FF00"

export type ServiceAccount = { projectId: string; clientEmail: string; privateKey: string; tokenUri: string }

/** The fields Yard needs from a Google service-account JSON key, or null when it isn't one. */
export function parseServiceAccount(text: string): ServiceAccount | null {
  let j: Record<string, unknown>
  try {
    j = JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
  const str = (k: string) => (typeof j?.[k] === "string" && (j[k] as string).trim() ? (j[k] as string).trim() : null)
  const projectId = str("project_id")
  const clientEmail = str("client_email")
  const privateKey = str("private_key")?.replace(/\\n/g, "\n") ?? null
  const tokenUri = str("token_uri") ?? GOOGLE_TOKEN_URL
  if (j?.type !== "service_account" || !projectId || !clientEmail || !privateKey || !privateKey.includes("PRIVATE KEY")) return null
  // Only Google's own token endpoint: a doctored file must not send the signed assertion elsewhere.
  if (!/^https:\/\/oauth2\.googleapis\.com\/token$/.test(tokenUri)) return null
  return { projectId, clientEmail, privateKey, tokenUri }
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url")

/** The signed JWT assertion (RS256) for the jwt-bearer grant, valid for an hour from `nowSec`. */
export function buildAssertion(sa: ServiceAccount, nowSec: number) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claims = b64url(JSON.stringify({ iss: sa.clientEmail, scope: FCM_SCOPE, aud: sa.tokenUri, iat: nowSec, exp: nowSec + 3600 }))
  const input = `${header}.${claims}`
  const signature = createSign("RSA-SHA256").update(input).end().sign(sa.privateKey).toString("base64url")
  return `${input}.${signature}`
}

/** The form body exchanged at the token endpoint. */
export const tokenRequestBody = (assertion: string) => new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString()

/** How long to keep an access token: its lifetime less five minutes (at least a minute). */
export const tokenCacheMs = (expiresInSec: number) => Math.max(60, (Number.isFinite(expiresInSec) ? expiresInSec : 3600) - 300) * 1000

export const fcmSendUrl = (projectId: string) => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`

export type PushNotice = { id: string; kind: string; title: string; body: string; url: string }

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The relative Yard path a notification opens (never another site). */
export function pushPath(href: string | null | undefined, fallback = "/") {
  return typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\") ? href : fallback
}

/** The FCM v1 request body for one device. Data values are strings, as FCM requires. */
export function buildFcmMessage(token: string, n: PushNotice) {
  return {
    message: {
      token,
      notification: { title: cut(n.title, 120), body: cut(n.body, 240) },
      data: { url: n.url, kind: n.kind, id: n.id },
      android: { priority: "high", notification: { channel_id: ANDROID_CHANNEL_ID, color: ANDROID_COLOR, tag: n.id } },
    },
  }
}

/**
 * Whether an FCM error means the token is dead and its row should go: 404 / NOT_FOUND,
 * UNREGISTERED, or INVALID_ARGUMENT (a malformed or foreign token).
 */
export function fcmTokenGone(status: number, body: unknown) {
  if (status === 404) return true
  const err = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error
  if (err?.status === "NOT_FOUND" || err?.status === "INVALID_ARGUMENT" || err?.status === "UNREGISTERED") return true
  const details = Array.isArray(err?.details) ? (err.details as { errorCode?: unknown }[]) : []
  return details.some((d) => d?.errorCode === "UNREGISTERED" || d?.errorCode === "INVALID_ARGUMENT")
}
