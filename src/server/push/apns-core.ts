/**
 * Apple Push Notification service, Live Activity pushes: pure helpers (settings, the provider JWT
 * and its cache, the payload, what an APNs answer means). No database, no network and no
 * "server-only", so `tsx --test` checks them (apns.test.ts). Sending is in apns.ts; when to send is
 * in live-activity.ts.
 *
 * Settings (all in /etc/yard.env; the key itself stays a file on the server, never inline):
 *   APNS_KEY_PATH   the .p8 key file (readable by the yard user, mode 600 or 640)
 *   APNS_KEY_ID     the key's 10-character id (Apple Developer › Keys)
 *   APNS_TEAM_ID    the 10-character Team ID
 *   APNS_BUNDLE_ID  the app's bundle id (space.yardstore.app); the topic adds `.push-type.liveactivity`
 *   APNS_ENV        production (default: App Store and TestFlight builds) or development (Xcode builds)
 * Anything missing or unreadable: Live Activity pushes are off (one log line at boot).
 */
import { createPrivateKey, createSign, type KeyObject } from "node:crypto"
import type { LiveState } from "./live-activity-state"

export type ApnsEnv = "production" | "development"
export type ApnsConfig = { keyId: string; teamId: string; bundleId: string; env: ApnsEnv; key: KeyObject; origin: string; topic: string }

type EnvLike = Record<string, string | undefined>

export const APNS_ORIGINS: Record<ApnsEnv, string> = { production: "https://api.push.apple.com", development: "https://api.sandbox.push.apple.com" }

/** The Live Activity topic for a bundle id. */
export const liveActivityTopic = (bundleId: string) => `${bundleId}.push-type.liveactivity`

/**
 * Reads the settings. `config` is null when Live Activity pushes are off, and `problem` says why
 * in one line (for the boot log; it never contains the key).
 */
export function readApnsConfig(env: EnvLike, readKey: (path: string) => string): { config: ApnsConfig | null; problem: string | null } {
  const v = (k: string) => env[k]?.trim() || ""
  const missing = ["APNS_KEY_PATH", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID"].filter((k) => !v(k))
  if (missing.length) return { config: null, problem: `${missing.join(", ")} not set` }
  const keyId = v("APNS_KEY_ID")
  const teamId = v("APNS_TEAM_ID")
  const bundleId = v("APNS_BUNDLE_ID")
  if (!/^[A-Z0-9]{10}$/.test(keyId)) return { config: null, problem: "APNS_KEY_ID is not a 10-character key id" }
  if (!/^[A-Z0-9]{10}$/.test(teamId)) return { config: null, problem: "APNS_TEAM_ID is not a 10-character Team ID" }
  if (!/^[A-Za-z0-9.-]{3,155}$/.test(bundleId)) return { config: null, problem: "APNS_BUNDLE_ID is not a bundle id" }
  const envName = (v("APNS_ENV") || "production").toLowerCase()
  if (envName !== "production" && envName !== "development") return { config: null, problem: "APNS_ENV must be production or development" }
  let pem: string
  try {
    pem = readKey(v("APNS_KEY_PATH"))
  } catch {
    return { config: null, problem: "APNS_KEY_PATH can't be read by this process" }
  }
  let key: KeyObject
  try {
    key = createPrivateKey(pem)
  } catch {
    return { config: null, problem: "APNS_KEY_PATH is not a .p8 private key" }
  }
  if (key.asymmetricKeyType !== "ec") return { config: null, problem: "APNS_KEY_PATH is not an APNs (.p8, EC P-256) key" }
  const e = envName as ApnsEnv
  return { config: { keyId, teamId, bundleId, env: e, key, origin: APNS_ORIGINS[e], topic: liveActivityTopic(bundleId) }, problem: null }
}

/* ---------- Provider token (JWT, ES256) ---------- */

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url")

/** The provider authentication token: ES256 over { alg, kid } . { iss: team, iat }. */
export function buildProviderToken(c: Pick<ApnsConfig, "keyId" | "teamId" | "key">, nowSec: number) {
  const input = `${b64url(JSON.stringify({ alg: "ES256", kid: c.keyId }))}.${b64url(JSON.stringify({ iss: c.teamId, iat: nowSec }))}`
  const sig = createSign("SHA256").update(input).end().sign({ key: c.key, dsaEncoding: "ieee-p1363" })
  return `${input}.${sig.toString("base64url")}`
}

/**
 * Apple refuses a token older than an hour and one refreshed more often than every 20 minutes, so
 * a token is reused for 50 minutes.
 */
export const PROVIDER_TOKEN_TTL_MS = 50 * 60_000

export class ProviderTokenCache {
  private cached: { token: string; issuedMs: number } | null = null
  constructor(private readonly config: Pick<ApnsConfig, "keyId" | "teamId" | "key">) {}

  get(nowMs = Date.now()): string {
    if (this.cached && nowMs - this.cached.issuedMs < PROVIDER_TOKEN_TTL_MS && nowMs >= this.cached.issuedMs) return this.cached.token
    this.cached = { token: buildProviderToken(this.config, Math.floor(nowMs / 1000)), issuedMs: nowMs }
    return this.cached.token
  }

  /** APNs said the token is expired or invalid: the next get() signs a new one. */
  reset() {
    this.cached = null
  }
}

/* ---------- Payload ---------- */

/** Seconds between 1970-01-01 and 2001-01-01 (Foundation's reference date). */
export const REFERENCE_DATE_UNIX = 978_307_200

/**
 * `etaDate` as Swift's synthesized `Codable` writes a `Date` with the default strategy
 * (`.deferredToDate`): seconds since 2001-01-01 as a Double. ActivityKit decodes `content-state`
 * with its default strategies ("don't use any custom JSON encoding strategies", Apple), so this
 * is the number the app's `ContentState` reads back as the same instant.
 */
export const swiftDate = (ms: number) => ms / 1000 - REFERENCE_DATE_UNIX

/** `YardOrderActivityAttributes.ContentState` as JSON: keys step, etaDate (omitted when unknown), progress, statusLine. */
export function contentState(s: LiveState) {
  return { step: s.step, ...(s.etaMs != null ? { etaDate: swiftDate(s.etaMs) } : {}), progress: s.progress, statusLine: s.statusLine }
}

/** `YardOrderActivityAttributes` (the static part) for a push-to-start. */
export type LiveAttributes = { orderId: string; brandName: string; brandCity: string; deliveryCity: string }

export type LivePush =
  | { event: "update"; state: LiveState; nowMs: number; staleMs: number; relevance: number }
  | { event: "end"; state: LiveState; nowMs: number; dismissalMs: number; relevance: number }
  | { event: "start"; state: LiveState; nowMs: number; staleMs: number; relevance: number; attributes: LiveAttributes; alert: { title: string; body: string } }

const sec = (ms: number) => Math.floor(ms / 1000)

/** The JSON body for one Live Activity push. `timestamp`, `stale-date` and `dismissal-date` are Unix seconds (APNs). */
export function buildLiveActivityPayload(p: LivePush) {
  const aps: Record<string, unknown> = { timestamp: sec(p.nowMs), event: p.event, "content-state": contentState(p.state), "relevance-score": p.relevance }
  if (p.event === "update" || p.event === "start") aps["stale-date"] = sec(p.staleMs)
  if (p.event === "end") aps["dismissal-date"] = sec(p.dismissalMs)
  if (p.event === "start") {
    aps["attributes-type"] = "YardOrderActivityAttributes"
    aps.attributes = p.attributes
    aps.alert = { title: p.alert.title, body: p.alert.body }
    // iOS 18+: also hand the app an update token for the started activity.
    aps["input-push-token"] = 1
  }
  return { aps }
}

/** Relevance (which of several Yard activities leads the Dynamic Island): nearer the door ranks higher. */
export const RELEVANCE: Record<LiveState["step"], number> = { packed: 20, shipped: 40, arrivingSoon: 70, outForDelivery: 100, delivered: 60 }

/** The request headers (besides authorization). Priority 10 = now (counts against Apple's budget), 5 = when convenient. */
export function apnsHeaders(topic: string, priority: 5 | 10) {
  return { "apns-push-type": "liveactivity", "apns-topic": topic, "apns-priority": String(priority), "content-type": "application/json" }
}

/* ---------- Answers ---------- */

/** The token will never work again: 410, or 400 BadDeviceToken / DeviceTokenNotForTopic. Delete it. */
export function apnsTokenGone(status: number, reason: string | null | undefined) {
  if (status === 410) return true
  return status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")
}

/** The provider token was refused (expired or invalid): sign a new one and retry once. */
export const apnsAuthRefused = (status: number, reason: string | null | undefined) => status === 403 && (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken")

/** An ActivityKit push token as the app sends it: hex. */
export const LIVE_TOKEN_RE = /^[0-9a-f]{32,512}$/i

/* ---------- When to push ---------- */

/** An update younger than this isn't re-sent by the hourly refresh unless something moved. */
export const REFRESH_AFTER_MS = 6 * 3_600_000
/** The app's stale window: the activity says "Open Yard for the latest update" after 8 hours without news. */
export const STALE_AFTER_MS = 8 * 3_600_000
/** A delivered activity stays on the Lock Screen this long (as the app's end(…) does). */
export const DELIVERED_DISMISS_MS = 2 * 3_600_000

/**
 * Whether to send an update, and how urgently.
 * - Nothing sent yet, or a new step: priority 10 (the person should see it now).
 * - New wording or ETA: priority 5.
 * - An event with only progress moved: priority 5. The same state again (a refund, a note): nothing.
 * - Hourly refresh: only when progress moved by 0.05 or more, or the last push is 6 hours old
 *   (so the activity never goes stale while the order is on its way). Priority 5.
 */
export function pushDecision(last: LiveState | null, next: LiveState, lastSentMs: number | null, nowMs: number, refresh: boolean): { send: boolean; priority: 5 | 10 } {
  if (!last || last.step !== next.step) return { send: true, priority: 10 }
  if (last.statusLine !== next.statusLine || (last.etaMs ?? null) !== (next.etaMs ?? null)) return { send: true, priority: 5 }
  const moved = Math.abs(last.progress - next.progress)
  if (!refresh) return { send: moved > 1e-9, priority: 5 }
  const old = lastSentMs == null || nowMs - lastSentMs >= REFRESH_AFTER_MS
  return { send: moved >= 0.05 || old, priority: 5 }
}

/** Reads a stored last state back (jsonb), or null when it isn't one. */
export function asLiveState(v: unknown): LiveState | null {
  const o = v as Partial<LiveState> | null
  if (!o || typeof o !== "object" || typeof o.step !== "string" || typeof o.progress !== "number" || typeof o.statusLine !== "string") return null
  return { step: o.step as LiveState["step"], etaMs: typeof o.etaMs === "number" ? o.etaMs : null, progress: o.progress, statusLine: o.statusLine }
}
