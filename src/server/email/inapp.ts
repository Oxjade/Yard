import "server-only"
import { isSameOriginPath } from "@/lib/api/contracts/notifications"
import { db } from "../db"
import { notifications } from "../db/schema"
import { newId } from "../ids"
import { recipientChannel, toNotificationDto } from "../notify"
import { publish } from "../realtime/bus"
import type { OptionalCategory } from "./preferences"

/**
 * In-app notifications for ENGAGEMENT events (drops, draws, price drops, back in stock). Same row
 * shape, upsert rule and realtime event as notify() (src/server/notify.ts), with this area's own
 * templates so the shared template file isn't edited. Variables are names and formatted values
 * only, cut to 80 characters.
 */
type Vars = Record<string, string | number | undefined>
const s = (v: string | number | undefined, fallback = "") => String(v ?? fallback).slice(0, 80)
/** "1 winner", "3 winners": a count var with the noun that agrees with it (0 when missing). */
const count = (v: string | number | undefined, one: string, many: string) => {
  const n = Number(v ?? 0) || 0
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`
}

const templates = {
  "drop.reminder": { category: "drop_update", pref: "drops", build: (v: Vars) => ({ title: `${s(v.drop)} drops ${s(v.when, "soon")}`, body: `${s(v.brand, "The brand")} releases it soon. Be ready.` }) },
  "drop.live": { category: "drop_update", pref: "drops", build: (v: Vars) => ({ title: `${s(v.drop)} is live`, body: `${s(v.brand, "The brand")} just released it.` }) },
  "drop.early_access": { category: "drop_update", pref: "drops", build: (v: Vars) => ({ title: `Early access: ${s(v.drop)}`, body: `As a follower of ${s(v.brand, "the brand")} you can shop it now.` }) },
  "drop.draw_won": { category: "drop_update", pref: "drops", build: (v: Vars) => ({ title: `You won the ${s(v.drop)} draw`, body: `Buy before ${s(v.until, "your window closes")}.` }) },
  "drop.draw_lost": { category: "drop_update", pref: "drops", build: (v: Vars) => ({ title: `${s(v.drop)}: not drawn this time`, body: "If a winner doesn't buy in time, places pass down the list." }) },
  "drop.draw_closed_for_brand": { category: "drop_update", pref: null, build: (v: Vars) => ({ title: `Draw complete: ${s(v.drop)}`, body: `${count(v.winners, "winner", "winners")} from ${count(v.entries, "entry", "entries")}.` }) },
  "wishlist.price_drop": { category: "price_drop", pref: "price_drops", build: (v: Vars) => ({ title: `Price drop: ${s(v.product)}`, body: `Now ${s(v.price)}${v.was ? `, was ${s(v.was)}` : ""}.` }) },
  "wishlist.back_in_stock": { category: "back_in_stock", pref: "back_in_stock", build: (v: Vars) => ({ title: `Back in stock: ${s(v.product)}`, body: `${s(v.brand, "The brand")} restocked it.` }) },
} as const satisfies Record<string, { category: string; pref: OptionalCategory | null; build: (v: Vars) => { title: string; body: string } }>

export type EngagementTemplate = keyof typeof templates

export function inAppPref(template: EngagementTemplate): OptionalCategory | null {
  return templates[template].pref
}

/** Upserts a notification for a shopper (or brand) and publishes notification.created after commit. Call inside withTx. */
export async function notifyEngagement(recipient: { kind: "shopper" | "brand"; id: string }, n: { key: string; template: EngagementTemplate; vars?: Vars; href?: string | null }) {
  if (n.href != null && !isSameOriginPath(n.href)) throw new Error(`notifyEngagement(${n.key}): href must be a Yard path`)
  const t = templates[n.template]
  const { title, body } = t.build(n.vars ?? {})
  const d = await db()
  const now = new Date()
  const [row] = await d
    .insert(notifications)
    .values({ id: newId("nt"), recipientKind: recipient.kind, recipientId: recipient.id, eventKey: n.key.slice(0, 200), category: t.category, title, body, href: n.href ?? null, createdAt: now })
    .onConflictDoUpdate({ target: [notifications.recipientKind, notifications.recipientId, notifications.eventKey], set: { title, body, category: t.category, href: n.href ?? null, createdAt: now, readAt: null } })
    .returning()
  const dto = toNotificationDto(row)
  await publish(recipientChannel(recipient), "notification.created", dto)
  return dto
}
