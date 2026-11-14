import "server-only"
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm"
import { adminRolePermissions, type AdminPermission, type AdminRole } from "@/lib/permissions"
import { detectorLabels } from "@/lib/api/contracts/admin"
import { isSameOriginPath, type NotificationDto } from "@/lib/api/contracts/notifications"
import type { Actor } from "./auth/dal"
import { db } from "./db"
import { adminMembers, notifications } from "./db/schema"
import { newId } from "./ids"
import { render, type TemplateKey } from "./notify-templates"
import { queuePush } from "./push"
import { publish } from "./realtime/bus"
import { channels } from "./realtime/channels"

export type Recipient = { kind: "shopper" | "brand" | "admin"; id: string }

/** The recipient an actor reads as: a brand member reads the active brand's notifications. */
export function recipientOf(actor: Actor): Recipient {
  if (actor.kind === "shopper") return { kind: "shopper", id: actor.userId }
  if (actor.kind === "brand") return { kind: "brand", id: actor.brandId }
  return { kind: "admin", id: actor.userId }
}

/** shopper → user:<id>; brand (brand-wide) → brand:<brandId>; admin → admin:<adminId>. */
export function recipientChannel(r: Recipient) {
  return r.kind === "shopper" ? channels.user(r.id) : r.kind === "brand" ? channels.brand(r.id) : channels.adminUser(r.id)
}

/** Detector names as Admin › Charts labels them, by key or by a lower-cased label (older chart.integrity rows). */
const detectorNames: Record<string, string> = Object.fromEntries(Object.entries(detectorLabels).flatMap(([k, v]) => [[k, v], [v.toLowerCase(), v]]))

/**
 * Text stored by older templates, as the current templates write it: "Brand · high severity"
 * meta strings become a sentence, and chart.integrity titles name the detector as Admin › Charts
 * does ("IP concentration", not "ip concentration"). Rows aren't rewritten; every read upgrades them.
 */
export function currentNotificationText(category: string, title: string, body: string) {
  let t = title
  const b = body
  if (category === "chart_integrity") {
    const m = /^Chart integrity: (.+)$/.exec(t)
    if (m) t = `Chart integrity: ${detectorNames[m[1]] ?? detectorNames[m[1].toLowerCase()] ?? m[1].charAt(0).toUpperCase() + m[1].slice(1)}`
  }
  const sentence = (s: string) => {
    if (!s.includes(" · ")) return s
    const joined = s.split(" · ").join(", ")
    return /[.!?]$/.test(joined) ? joined : `${joined}.`
  }
  return { title: sentence(t), body: sentence(b) }
}

export function toNotificationDto(row: typeof notifications.$inferSelect): NotificationDto {
  const text = currentNotificationText(row.category, row.title, row.body)
  return {
    id: row.id,
    key: row.eventKey,
    recipient: { kind: row.recipientKind as Recipient["kind"], id: row.recipientId },
    category: row.category,
    title: text.title,
    body: text.body,
    href: row.href,
    at: row.createdAt.toISOString(),
    read: !!row.readAt,
  }
}

/**
 * Upserts a notification (unique per recipient and key; an upsert marks it unread again and
 * refreshes its text and time) and publishes notification.created after commit (§2.7). The same
 * notification goes to the recipient's phones as a push after commit (src/server/push).
 */
export async function notify(recipient: Recipient, n: { key: string; template: TemplateKey; vars?: Record<string, string | number | undefined>; href?: string | null; category?: string }) {
  // Notifications open with router.push(href): only same-origin paths, never another site.
  if (n.href != null && !isSameOriginPath(n.href)) throw new Error(`notify(${n.key}): href must be a path on Yard (got ${JSON.stringify(String(n.href).slice(0, 80))})`)
  const { category, title, body } = render(n.template, n.vars ?? {})
  const d = await db()
  const now = new Date()
  const [row] = await d
    .insert(notifications)
    .values({ id: newId("nt"), recipientKind: recipient.kind, recipientId: recipient.id, eventKey: n.key, category: n.category ?? category, title, body, href: n.href ?? null, createdAt: now })
    .onConflictDoUpdate({
      target: [notifications.recipientKind, notifications.recipientId, notifications.eventKey],
      set: { title, body, category: n.category ?? category, href: n.href ?? null, createdAt: now, readAt: null },
    })
    .returning()
  const dto = toNotificationDto(row)
  await publish(recipientChannel(recipient), "notification.created", dto)
  queuePush(recipient, dto)
  return dto
}

/**
 * Tells every open tab of each recipient that these notifications were deleted on the server
 * (publishes notification.removed on the recipient's channel; durable, so a tab that reconnects
 * learns it from the replay too). Call it inside the transaction that deleted the rows: the
 * event is announced after commit. I, M and D restores should call it for rows they delete.
 */
export async function announceRemovedNotifications(rows: { kind: Recipient["kind"]; id: string; key: string }[]) {
  const by = new Map<string, { recipient: Recipient; keys: string[] }>()
  for (const r of rows) {
    const k = `${r.kind}:${r.id}`
    const e = by.get(k) ?? { recipient: { kind: r.kind, id: r.id }, keys: [] }
    if (!e.keys.includes(r.key)) e.keys.push(r.key)
    by.set(k, e)
  }
  for (const { recipient, keys } of by.values()) {
    for (let i = 0; i < keys.length; i += 200) await publish(recipientChannel(recipient), "notification.removed", { recipient, keys: keys.slice(i, i + 200) })
  }
  return by.size
}

/** The admin roles that hold `permission`. */
export function rolesWith(permission: AdminPermission) {
  return (Object.keys(adminRolePermissions) as AdminRole[]).filter((r) => adminRolePermissions[r].includes(permission))
}

/** Notifies only the admins whose role holds the queue's view permission (§2.7). */
export async function notifyAdmins(permission: AdminPermission, n: Parameters<typeof notify>[1]) {
  const d = await db()
  const admins = await d.select({ id: adminMembers.userId }).from(adminMembers).where(inArray(adminMembers.role, rolesWith(permission)))
  const out: NotificationDto[] = []
  for (const a of admins) out.push(await notify({ kind: "admin", id: a.id }, n))
  return out
}

/** A recipient's notifications, newest first (optionally only those after `after`). */
export async function listNotifications(recipient: Recipient, after?: Date, limit = 100) {
  const d = await db()
  const rows = await d
    .select()
    .from(notifications)
    .where(and(eq(notifications.recipientKind, recipient.kind), eq(notifications.recipientId, recipient.id), after ? gt(notifications.createdAt, after) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
  return rows.map(toNotificationDto)
}

/**
 * Marks a recipient's notifications read or unread by event key (or all), then publishes
 * notification.read so every tab of that recipient applies it without calling back.
 */
export async function markNotifications(recipient: Recipient, opts: { keys?: string[]; all?: boolean; read?: boolean }) {
  const read = opts.read ?? true
  const d = await db()
  const scope = and(eq(notifications.recipientKind, recipient.kind), eq(notifications.recipientId, recipient.id))
  const which = opts.all ? scope : and(scope, inArray(notifications.eventKey, opts.keys?.length ? opts.keys : ["\u0000"]))
  const rows = await d
    .update(notifications)
    .set({ readAt: read ? sql`coalesce(${notifications.readAt}, now())` : null })
    .where(read ? and(which, isNull(notifications.readAt)) : which)
    .returning({ key: notifications.eventKey })
  const keys = rows.map((r) => r.key)
  if (keys.length || opts.all) await publish(recipientChannel(recipient), "notification.read", { recipient, keys, all: !!opts.all, read })
  return { updated: keys.length, keys, read }
}
