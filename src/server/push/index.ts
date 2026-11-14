import "server-only"
import { readFileSync } from "node:fs"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import type { NotificationDto } from "@/lib/api/contracts/notifications"
import { afterCommit, db } from "../db"
import { brandMembers } from "../db/schema"
import { pushDevices, PUSH_PLATFORMS } from "../db/schema/engagement"
import { getPreferencesMany, type OptionalCategory } from "../email/preferences"
import { newId } from "../ids"
import { log } from "../log"
import { yard } from "../state"
import { buildAssertion, buildFcmMessage, fcmSendUrl, fcmTokenGone, parseServiceAccount, pushPath, tokenCacheMs, tokenRequestBody, type PushNotice, type ServiceAccount } from "./fcm-core"

/**
 * Push notifications to the Yard apps. Every in-app notification (notify() and notifyEngagement())
 * also goes, after its transaction commits, to the phones of the people it is for: a shopper's own
 * devices, or every active member of a brand (not Yard setup). Fire-and-forget: a slow or failing
 * push never slows or fails the request that created the notification. Optional categories
 * (drops, price drops, back in stock, brand news) follow the in-app preference.
 *
 * Android uses Firebase Cloud Messaging HTTP v1 (free). FCM_SERVICE_ACCOUNT_FILE names the service
 * account JSON on the server (e.g. /etc/yard/fcm-service-account.json, readable by the yard user);
 * the project id comes from that file. Unset or unreadable: pushes are a silent no-op (logged once).
 * iOS devices can register already; they get pushes once a sender is added to SENDERS.
 */
export type PushPlatform = (typeof PUSH_PLATFORMS)[number]

type Device = { id: string; token: string; platform: PushPlatform }
type Sender = (devices: Device[], n: PushNotice) => Promise<void>

/* ---------- Devices ---------- */

/** Registers (or re-points to this user) a device token and bumps last_seen_at; a missing appVersion keeps the stored one. */
export async function registerDevice(userId: string, input: { platform: PushPlatform; token: string; appVersion?: string | null }) {
  const d = await db()
  const now = new Date()
  await d
    .insert(pushDevices)
    .values({ id: newId("pd"), userId, platform: input.platform, token: input.token, appVersion: input.appVersion ?? null, createdAt: now, lastSeenAt: now })
    .onConflictDoUpdate({ target: pushDevices.token, set: { userId, platform: input.platform, appVersion: input.appVersion ?? sql`${pushDevices.appVersion}`, lastSeenAt: now } })
}

/** Removes a token, only when it belongs to `userId`. */
export async function removeDevice(userId: string, token: string) {
  const d = await db()
  await d.delete(pushDevices).where(and(eq(pushDevices.token, token), eq(pushDevices.userId, userId)))
}

/** Every device of a user (account deletion). */
export async function removeDevicesOf(userId: string) {
  const d = await db()
  await d.delete(pushDevices).where(eq(pushDevices.userId, userId))
}

/* ---------- FCM (Android) ---------- */

type FcmState = { sa: ServiceAccount | null; access?: { token: string; until: number }; pending?: Promise<string> }

function fcmConfig(): FcmState {
  const slots = (yard.slots ??= {})
  return (slots.fcm ??= (() => {
    const file = process.env.FCM_SERVICE_ACCOUNT_FILE?.trim()
    if (!file) {
      log.once("push:fcm-off", "info", "[yard] push: FCM_SERVICE_ACCOUNT_FILE is not set; Android push notifications are off.")
      return { sa: null }
    }
    let text: string
    try {
      text = readFileSync(file, "utf8")
    } catch {
      log.once("push:fcm-unreadable", "info", "[yard] push: FCM_SERVICE_ACCOUNT_FILE can't be read; Android push notifications are off.")
      return { sa: null }
    }
    const sa = parseServiceAccount(text)
    if (!sa) log.once("push:fcm-invalid", "info", "[yard] push: FCM_SERVICE_ACCOUNT_FILE is not a Google service-account key; Android push notifications are off.")
    return { sa }
  })()) as FcmState
}

/** A cached access token (until ~5 minutes before it expires); concurrent callers share one exchange. */
function fcmAccessToken(state: FcmState, sa: ServiceAccount): Promise<string> {
  if (state.access && state.access.until > Date.now()) return Promise.resolve(state.access.token)
  state.pending ??= exchangeToken(state, sa).finally(() => {
    state.pending = undefined
  })
  return state.pending
}

async function exchangeToken(state: FcmState, sa: ServiceAccount) {
  const res = await fetch(sa.tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequestBody(buildAssertion(sa, Math.floor(Date.now() / 1000))),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null
  if (!res.ok || typeof body?.access_token !== "string") throw new Error(`FCM token exchange answered ${res.status}`)
  state.access = { token: body.access_token, until: Date.now() + tokenCacheMs(Number(body.expires_in)) }
  return body.access_token
}

const sendFcm: Sender = async (devices, n) => {
  const state = fcmConfig()
  if (!state.sa) return
  const sa = state.sa
  let access: string
  try {
    access = await fcmAccessToken(state, sa)
  } catch (e) {
    log.warn("[yard] push: FCM sign-in failed", e)
    return
  }
  const gone: string[] = []
  for (const dev of devices) {
    try {
      const res = await fetch(fcmSendUrl(sa.projectId), {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildFcmMessage(dev.token, n)),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) continue
      const body = await res.json().catch(() => null)
      if (fcmTokenGone(res.status, body)) gone.push(dev.id)
      else if (res.status === 401) state.access = undefined // a revoked token: sign in again next time
      else log.warn(`[yard] push: FCM answered ${res.status} for device ${dev.id}`)
    } catch (e) {
      log.warn(`[yard] push: FCM send to device ${dev.id} failed`, e)
    }
  }
  if (gone.length) {
    const d = await db()
    await d.delete(pushDevices).where(inArray(pushDevices.id, gone))
  }
}

/** One sender per platform; a platform without one keeps its devices but gets no pushes yet. */
const SENDERS: Partial<Record<PushPlatform, Sender>> = { android: sendFcm }

/* ---------- Fan-out ---------- */

/** The users a notification recipient stands for: a shopper, or a brand's active members. */
async function recipientUsers(recipient: { kind: "shopper" | "brand" | "admin"; id: string }) {
  if (recipient.kind === "shopper") return [recipient.id]
  if (recipient.kind !== "brand") return []
  const d = await db()
  const rows = await d
    .select({ userId: brandMembers.userId })
    .from(brandMembers)
    .where(and(eq(brandMembers.brandId, recipient.id), eq(brandMembers.status, "active"), ne(brandMembers.role, "yard_setup")))
  return [...new Set(rows.map((r) => r.userId))]
}

async function deliver(recipient: { kind: "shopper" | "brand" | "admin"; id: string }, n: NotificationDto, pref: OptionalCategory | null) {
  let userIds = await recipientUsers(recipient)
  if (!userIds.length) return
  if (pref) {
    const prefs = await getPreferencesMany(userIds)
    userIds = userIds.filter((u) => prefs.get(u)?.inApp[pref] !== false)
    if (!userIds.length) return
  }
  const d = await db()
  const rows = await d.select({ id: pushDevices.id, token: pushDevices.token, platform: pushDevices.platform }).from(pushDevices).where(inArray(pushDevices.userId, userIds))
  if (!rows.length) return
  const notice: PushNotice = { id: n.id, kind: n.category, title: n.title, body: n.body, url: pushPath(n.href, recipient.kind === "brand" ? "/studio" : "/") }
  for (const platform of PUSH_PLATFORMS) {
    const send = SENDERS[platform]
    const devices = rows.filter((r) => r.platform === platform) as Device[]
    if (send && devices.length) await send(devices, notice)
  }
}

/**
 * Queues the push for a notification just written. Call it where the notification row is
 * written (inside its transaction or not): it runs only after commit, in the background.
 * Admin notifications aren't pushed (the Control Center has no app).
 */
export function queuePush(recipient: { kind: "shopper" | "brand" | "admin"; id: string }, n: NotificationDto, pref: OptionalCategory | null = null) {
  if (recipient.kind === "admin") return
  afterCommit(() => {
    void deliver(recipient, n, pref).catch((e) => log.warn("[yard] push: delivery failed", e))
  })
}
