"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { api } from "@/lib/api/client"
import { isSameOriginPath } from "@/lib/api/contracts/notifications"
import { getServerSessionState, recipientFor, type SessionSurface } from "@/lib/session/use-server-session"
import { currentReferences, withCurrentName } from "./old-name"

/**
 * Notifications, persisted and shared across tabs. Every notification comes from an event
 * in the application's own data — an order placed, stock running low, a payout decided,
 * a report filed — keyed by that event so it is never created twice. In the backend phase
 * the same shape is written by the server and delivered by polling or a socket.
 */

export type Audience = "customer" | "merchant" | "admin"

export type NotificationCategory =
  // customer
  | "order_confirmed"
  | "order_shipped"
  | "order_delivered"
  | "brand_announcement"
  | "drop_live"
  | "wishlist_update"
  | "followed_activity"
  | "refund"
  // merchant
  | "new_order"
  | "payment_received"
  | "low_inventory"
  | "out_of_stock"
  | "new_follower"
  | "drop_performance"
  | "campaign_review"
  | "payout_status"
  | "refund_request"
  /** The review team's decision on the brand itself: approved, verified, restricted, suspended or reinstated. */
  | "account_status"
  // v2 server notifications (§2.7): customer
  | "new_message"
  | "delivery_update"
  | "report_update"
  // v2: merchant (new_message and delivery updates above are shared)
  | "social_status"
  | "content_moderation"
  | "location_review"
  | "chart_movement"
  | "delivery_complaint"
  // v2: admin
  | "message_report"
  | "content_report"
  | "place_report"
  | "chart_integrity"
  | "shipping_issue"
  | "abuse_alert"
  // admin
  | "merchant_application"
  | "product_report"
  | "payment_failure"
  | "chargeback"
  | "suspicious_activity"
  | "system_alert"

export type AppNotification = {
  id: string
  /** The source event — the dedupe key. */
  eventKey: string
  audience: Audience
  category: NotificationCategory
  title: string
  body: string
  href?: string
  at: string
  read: boolean
  /** True when derived from the development sample data rather than an action taken in this browser. */
  sample?: boolean
  /**
   * Server notifications only: who they were sent to, as '<kind>:<id>' (shopper:u_ada,
   * brand:b_lagos_static, admin:adm_3). Their event keys read srv:<kind>:<id>:<server key>.
   */
  recipient?: string
}

/** A server notification as the bridge hands it to the store (§2.7). */
export type ServerItem = {
  /** The server's own event key (e.g. "msg:cv_seed_ada_ls"). */
  key: string
  audience: Audience
  /** '<kind>:<id>' */
  recipient: string
  category: NotificationCategory
  title: string
  body: string
  href?: string | null
  at: string
  read: boolean
}

const SRV = "srv:"
/** srv:<recipientKind>:<recipientId>:<key> */
export const serverEventKey = (recipient: string, key: string) => `${SRV}${recipient}:${key}`
export const isServerItem = (n: Pick<AppNotification, "eventKey">) => n.eventKey.startsWith(SRV)
/** The server key and recipient back out of a srv: event key. */
export function parseServerKey(eventKey: string) {
  const m = /^srv:(shopper|brand|admin):([^:]+):(.+)$/.exec(eventKey)
  return m ? { kind: m[1] as "shopper" | "brand" | "admin", id: m[2], recipient: `${m[1]}:${m[2]}`, key: m[3] } : null
}

const surfaceOf: Record<Audience, SessionSurface> = { customer: "market", merchant: "studio", admin: "admin" }
const actorOf: Record<Audience, "shopper" | "brand" | "admin"> = { customer: "shopper", merchant: "brand", admin: "admin" }

/**
 * The notifications a surface shows (§2.7): local ones always; srv: ones only once the server
 * session is known, and only the current recipient's, so nothing flashes before a purge runs.
 * Pass `recipient: null` while the session is loading or signed out.
 */
export function visibleItems(items: AppNotification[], audience: Audience, recipient: string | null) {
  return items.filter((n) => n.audience === audience && (!isServerItem(n) || (recipient !== null && n.recipient === recipient)))
}

/** Tells the server, for srv: items of the current recipient only. Failures leave the local state as is. */
function syncServerRead(items: AppNotification[], read: boolean) {
  const byRecipient = new Map<string, { kind: "shopper" | "brand" | "admin"; keys: string[] }>()
  for (const n of items) {
    const p = parseServerKey(n.eventKey)
    if (!p) continue
    const current = recipientFor(surfaceOf[n.audience], getServerSessionState())
    if (current !== p.recipient) continue
    const entry = byRecipient.get(p.recipient) ?? { kind: p.kind, keys: [] }
    entry.keys.push(p.key)
    byRecipient.set(p.recipient, entry)
  }
  for (const { kind, keys } of byRecipient.values()) {
    void api("/api/notifications/read", { query: { as: kind }, body: { keys, read } }).catch(() => {})
  }
}

type State = {
  items: AppNotification[]
  seeded: Record<Audience, boolean>
  push: (n: Omit<AppNotification, "id" | "read"> & { read?: boolean }) => boolean
  pushMany: (list: (Omit<AppNotification, "id" | "read"> & { read?: boolean })[]) => void
  markRead: (id: string) => void
  markUnread: (id: string) => void
  markAllRead: (audience: Audience) => void
  remove: (id: string) => void
  setSeeded: (audience: Audience) => void
  /** Bridge only: inserts or replaces srv: items by event key (pushMany drops repeat keys). */
  upsertServer: (items: ServerItem[]) => void
  /** Applies a notification.read event locally without calling the server (no ping-pong). */
  applyServerRead: (target: { eventKeys: string[] } | { recipient: string; audience: Audience }, read: boolean) => void
  /** Removes srv: items of `audience` whose recipient isn't `keepRecipient` (null: all of them). */
  purgeServerItems: (audience: Audience, keepRecipient: string | null) => void
}

const MAX = 200

/** Where an admin notification opens: the record it is about, on the screen that decides it. */
export const adminLinks = {
  application: (id: string) => `/admin/brands?review=${encodeURIComponent(id)}`,
  report: (id: string) => `/admin/products?case=${encodeURIComponent(id)}`,
  dispute: (id: string) => `/admin/finance?tab=disputes&focus=${encodeURIComponent(id)}#finance-sections`,
  refund: (id: string) => `/admin/finance?tab=refunds&focus=${encodeURIComponent(id)}#finance-sections`,
  payout: (id: string) => `/admin/finance?tab=payouts&focus=${encodeURIComponent(id)}#finance-sections`,
  webhooks: "/admin/health#webhooks",
  failedJobs: "/admin/health#failed-jobs",
}

/**
 * The record an admin notification opens, from its event key ("a:<kind>:<record id>[:<step>]").
 * Every admin notification goes through it as it is pushed, so an event raised anywhere opens its
 * record, and so do notifications saved when they all opened a screen's front page. Null for an
 * event that has no record screen (it keeps the link it was given).
 */
export function adminLinkFor(eventKey: string) {
  const [, kind, rest] = /^a:([a-z]+):(.+)$/.exec(eventKey) ?? []
  // Record ids never contain ":"; what follows one is the step ("requested").
  const id = rest?.split(":")[0]
  if (!id) return null
  switch (kind) {
    case "app":
    case "risk":
      return adminLinks.application(id)
    case "report":
      return adminLinks.report(id)
    case "cb":
      return adminLinks.dispute(id)
    case "refund":
      return adminLinks.refund(id)
    // A shopper's return request: the refund it opened is keyed by the order.
    case "return":
      return adminLinks.refund(`rf_${id}`)
    case "payout":
      return adminLinks.payout(id)
    case "webhook":
      return adminLinks.webhooks
    case "job":
      return adminLinks.failedJobs
    default:
      return null
  }
}

type Pushed = Omit<AppNotification, "id" | "read"> & { read?: boolean }

/** A pushed notification as it's stored: unread unless said otherwise, and an admin one linked to its record. */
function stored(n: Pushed): AppNotification {
  const href = n.audience === "admin" ? (adminLinkFor(n.eventKey) ?? n.href) : n.href
  return { ...n, href, read: n.read ?? false, id: `n_${n.eventKey}` }
}

export const useNotifications = create<State>()(
  persist(
    (set, get) => ({
      items: [],
      seeded: { customer: false, merchant: false, admin: false },
      push: (n) => {
        if (get().items.some((x) => x.eventKey === n.eventKey)) return false
        set({ items: [stored(n), ...get().items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX) })
        return true
      },
      pushMany: (list) => {
        const keys = new Set(get().items.map((x) => x.eventKey))
        const fresh = list.filter((n) => !keys.has(n.eventKey)).map(stored)
        if (!fresh.length) return
        set({ items: [...fresh, ...get().items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX) })
      },
      markRead: (id) => {
        const target = get().items.find((x) => x.id === id && !x.read)
        set({ items: get().items.map((x) => (x.id === id ? { ...x, read: true } : x)) })
        if (target) syncServerRead([target], true)
      },
      markUnread: (id) => {
        const target = get().items.find((x) => x.id === id && x.read)
        set({ items: get().items.map((x) => (x.id === id ? { ...x, read: false } : x)) })
        if (target) syncServerRead([target], false)
      },
      markAllRead: (audience) => {
        const changed = get().items.filter((x) => x.audience === audience && !x.read)
        set({ items: get().items.map((x) => (x.audience === audience ? { ...x, read: true } : x)) })
        syncServerRead(changed, true)
      },
      remove: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
      setSeeded: (audience) => set({ seeded: { ...get().seeded, [audience]: true } }),
      upsertServer: (list) => {
        if (!list.length) return
        const incoming = new Map(
          list.map((n) => {
            const eventKey = serverEventKey(n.recipient, n.key)
            // Opened with router.push: a server href that isn't a same-origin path is dropped.
            const href = isSameOriginPath(n.href) ? n.href : undefined
            const item: AppNotification = { id: `n_${eventKey}`, eventKey, audience: n.audience, category: n.category, title: n.title, body: n.body, href, at: n.at, read: n.read, recipient: n.recipient }
            return [eventKey, item] as const
          }),
        )
        const kept = get().items.filter((x) => !incoming.has(x.eventKey))
        set({ items: [...incoming.values(), ...kept].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX) })
      },
      applyServerRead: (target, read) => {
        const match = "eventKeys" in target ? (x: AppNotification) => target.eventKeys.includes(x.eventKey) : (x: AppNotification) => isServerItem(x) && x.recipient === target.recipient && x.audience === target.audience
        set({ items: get().items.map((x) => (match(x) && x.read !== read ? { ...x, read } : x)) })
      },
      purgeServerItems: (audience, keepRecipient) => {
        const items = get().items
        const next = items.filter((x) => !(x.audience === audience && isServerItem(x) && x.recipient !== keepRecipient))
        if (next.length !== items.length) set({ items: next })
      },
    }),
    {
      name: "nocturne-notifications",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 3,
      // v1: notifications saved before the platform was renamed read its current name ("Yard
      // approved your application"). Event keys and ids stay as they were, so nothing is pushed twice.
      // v2: order references read their current form ("Order YRD-…", "#OS-10431"), and admin
      // notifications open the record they're about instead of the screen's front page.
      // v3: server notifications (srv:<kind>:<id>:<key>, with `recipient`) join the list; existing
      // items are kept unchanged.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<State>
        if (!p.items) return p as State
        const items = p.items.map((n) => {
          const text = { title: currentReferences(withCurrentName(n.title)), body: currentReferences(withCurrentName(n.body)) }
          const href = version < 2 && n.audience === "admin" ? (adminLinkFor(n.eventKey) ?? n.href) : n.href
          return { ...n, ...text, href }
        })
        return { ...p, items } as State
      },
    },
  ),
)

export const categoryLabel: Record<NotificationCategory, string> = {
  order_confirmed: "Order",
  order_shipped: "Shipping",
  order_delivered: "Delivered",
  brand_announcement: "Announcement",
  drop_live: "Drop",
  wishlist_update: "Wishlist",
  followed_activity: "Following",
  refund: "Refund",
  new_order: "Order",
  payment_received: "Payment",
  low_inventory: "Inventory",
  out_of_stock: "Inventory",
  new_follower: "Followers",
  drop_performance: "Drop",
  campaign_review: "Advertising",
  payout_status: "Payout",
  refund_request: "Refund",
  account_status: "Account",
  new_message: "Inbox",
  delivery_update: "Delivery",
  report_update: "Reports",
  social_status: "Social",
  content_moderation: "Content",
  location_review: "Locations",
  chart_movement: "Charts",
  delivery_complaint: "Delivery",
  message_report: "Messages",
  content_report: "Content",
  place_report: "Places",
  chart_integrity: "Charts",
  shipping_issue: "Delivery",
  abuse_alert: "Abuse",
  merchant_application: "Brands",
  product_report: "Moderation",
  payment_failure: "Payments",
  chargeback: "Disputes",
  suspicious_activity: "Risk",
  system_alert: "System",
}

/** The recipient whose srv: items a surface shows right now, or null while loading or signed out. */
export function currentRecipient(audience: Audience) {
  return recipientFor(surfaceOf[audience], getServerSessionState())
}

export { actorOf as notificationActorOf, surfaceOf as notificationSurfaceOf }
