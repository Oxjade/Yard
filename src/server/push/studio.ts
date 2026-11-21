import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import type { NotificationDto } from "@/lib/api/contracts/notifications"
import { brandRolePermissions, type BrandPermission, type MemberRole } from "@/lib/permissions"
import { afterCommit, db } from "../db"
import { brands } from "../db/schema"
import { pushDevices } from "../db/schema/engagement"
import { FINANCE_VIEW_ROLES } from "../ledger/config"
import { log } from "../log"
import { brandMembersIn, wantingPush, type PushPrefs } from "../studio-app/core"
import type { PushNotice } from "./fcm-core"
import { pushConfigured, sendToDevices, type Device, type PushPlatform } from "./index"

/**
 * Studio pushes (docs/APP.md › Studio in the app › Push): new orders, messages to the brand, low
 * stock and payouts sent, to the brand's active members (never Yard setup) whose role covers the
 * topic and who haven't switched the topic off (studio_push_preferences, per member and brand),
 * on their devices registered with `studio: true`. After commit, in the background: a slow or
 * failing push never slows or fails the request. Every send is logged on one line
 * (`[yard] push: studio …`), which is also the record when FCM isn't configured.
 */

export type StudioPushKind = "studio.order" | "studio.message" | "studio.low_stock" | "studio.payout" | "studio.approved" | "studio.test"

/** Who may get each topic: the roles that can act on it. */
const rolesWith = (p: BrandPermission) => (Object.keys(brandRolePermissions) as MemberRole[]).filter((r) => r !== "yard_setup" && brandRolePermissions[r].includes(p))
export const TOPIC_ROLES: Record<keyof PushPrefs, readonly string[]> = {
  orders: rolesWith("orders.fulfil"),
  messages: rolesWith("inbox.read"),
  lowStock: [...new Set([...rolesWith("content.publish"), ...rolesWith("orders.fulfil")])],
  payouts: FINANCE_VIEW_ROLES,
}

/** The app link for a Studio path (yard://studio/…). */
export function studioLink(kind: StudioPushKind, id: string | null) {
  const e = (s: string) => encodeURIComponent(s)
  switch (kind) {
    case "studio.order":
      return id ? `yard://studio/orders/${e(id)}` : "yard://studio/orders"
    case "studio.message":
      return id === "support" ? "yard://studio/support" : id ? `yard://studio/inbox/${e(id)}` : "yard://studio/inbox"
    case "studio.low_stock":
      return id ? `yard://studio/products/${e(id)}` : "yard://studio/products"
    case "studio.payout":
      return "yard://studio/payouts"
    default:
      return "yard://studio"
  }
}

export type StudioNotice = { kind: StudioPushKind; key: string; title: string; body: string; url: string; linkId: string | null }

async function devicesOf(userIds: string[]): Promise<Device[]> {
  if (!userIds.length) return []
  const d = await db()
  const rows = await d
    .select({ id: pushDevices.id, token: pushDevices.token, platform: pushDevices.platform })
    .from(pushDevices)
    .where(and(inArray(pushDevices.userId, userIds), eq(pushDevices.studio, true)))
  return rows.map((r) => ({ ...r, platform: r.platform as PushPlatform }))
}

function noticeOf(brandId: string, n: StudioNotice): PushNotice {
  // The key names the event, so a repeat (a retried webhook) replaces the earlier push on the phone.
  const id = `${n.kind}:${n.key}`.slice(0, 120)
  return { id, kind: n.kind, title: n.title, body: n.body, url: n.url, data: { scope: "studio", brandId, link: studioLink(n.kind, n.linkId) } }
}

/** Sends now to `userIds`' Studio devices. Returns how many devices were addressed. */
export async function sendStudioPush(brandId: string, userIds: string[], n: StudioNotice): Promise<{ devices: number; delivered: boolean }> {
  const devices = await devicesOf(userIds)
  const delivered = devices.some((dv) => pushConfigured(dv.platform))
  log.info(`[yard] push: studio ${n.kind} brand=${brandId} key=${n.key} users=${userIds.length} devices=${devices.length}${devices.length && !delivered ? " (no push sender configured: not sent)" : ""} title=${JSON.stringify(n.title)}`)
  if (devices.length) await sendToDevices(devices, noticeOf(brandId, n))
  return { devices: devices.length, delivered: devices.length > 0 && delivered }
}

/** Queues a Studio push on `topic` to the brand's members, after commit. */
export function queueStudioPush(brandId: string, topic: keyof PushPrefs, n: StudioNotice) {
  afterCommit(() => {
    void (async () => {
      const d = await db()
      const [b] = await d.select({ reviewStatus: brands.reviewStatus }).from(brands).where(eq(brands.id, brandId)).limit(1)
      if (!b || b.reviewStatus === "suspended") return
      const members = await brandMembersIn(d, brandId, TOPIC_ROLES[topic])
      const users = await wantingPush(d, brandId, [...new Set(members.map((m) => m.userId))], topic)
      if (!users.length) return
      await sendStudioPush(brandId, users, n)
    })().catch((e) => log.warn("[yard] push: studio delivery failed", e))
  })
}

/** A brand's new-message notification (inbox or Yard Support) as a Studio push. */
export function queueStudioMessagePush(brandId: string, n: NotificationDto) {
  const thread = /[?&]thread=([A-Za-z0-9_-]+)/.exec(n.href ?? "")?.[1] ?? null
  const support = (n.href ?? "").startsWith("/studio/support")
  queueStudioPush(brandId, "messages", { kind: "studio.message", key: n.key, title: n.title, body: n.body, url: n.href ?? "/studio/inbox", linkId: support ? "support" : thread })
}
