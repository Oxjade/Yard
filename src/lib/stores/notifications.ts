"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { withCurrentName } from "./old-name"

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
}

const MAX = 200

export const useNotifications = create<State>()(
  persist(
    (set, get) => ({
      items: [],
      seeded: { customer: false, merchant: false, admin: false },
      push: (n) => {
        if (get().items.some((x) => x.eventKey === n.eventKey)) return false
        const item: AppNotification = { ...n, read: n.read ?? false, id: `n_${n.eventKey}` }
        set({ items: [item, ...get().items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX) })
        return true
      },
      pushMany: (list) => {
        const keys = new Set(get().items.map((x) => x.eventKey))
        const fresh = list.filter((n) => !keys.has(n.eventKey)).map((n) => ({ ...n, read: n.read ?? false, id: `n_${n.eventKey}` }))
        if (!fresh.length) return
        set({ items: [...fresh, ...get().items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX) })
      },
      markRead: (id) => set({ items: get().items.map((x) => (x.id === id ? { ...x, read: true } : x)) }),
      markUnread: (id) => set({ items: get().items.map((x) => (x.id === id ? { ...x, read: false } : x)) }),
      markAllRead: (audience) => set({ items: get().items.map((x) => (x.audience === audience ? { ...x, read: true } : x)) }),
      remove: (id) => set({ items: get().items.filter((x) => x.id !== id) }),
      setSeeded: (audience) => set({ seeded: { ...get().seeded, [audience]: true } }),
    }),
    {
      name: "nocturne-notifications",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
      // v1: notifications saved before the platform was renamed read its current name ("Yard
      // approved your application"). Event keys and ids stay as they were, so nothing is pushed twice.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<State>
        return (p.items ? { ...p, items: p.items.map((n) => ({ ...n, title: withCurrentName(n.title), body: withCurrentName(n.body) })) } : p) as State
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
  merchant_application: "Brands",
  product_report: "Moderation",
  payment_failure: "Payments",
  chargeback: "Disputes",
  suspicious_activity: "Risk",
  system_alert: "System",
}
