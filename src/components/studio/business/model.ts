import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { site } from "@/config/site"
import { shoppers, type ShopperProfile } from "@/lib/data/orders"
import { DEMO_TODAY, hash, pick } from "@/lib/data/seed"
import { convert } from "@/lib/money"
import type { MerchantOrder, MerchantOrderStatus, PaymentStatus } from "@/lib/data/types"

/**
 * Rules for the Studio business pages, kept pure so the backend phase can reuse them
 * (as server-side queries) without touching the pages.
 */

/** The demo's "now" — the sample orders are placed relative to it. */
export const DEMO_NOW = new Date(`${DEMO_TODAY}T12:00:00Z`).getTime()
export const DAY_MS = 86_400_000
export const COMMISSION_RATE = site.commissionRate

/* ---------- Dates ---------- */

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const dateYearFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })

export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatDateYear = (iso: string) => dateYearFmt.format(new Date(iso))
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso))
export const formatTime = (iso: string) => timeFmt.format(new Date(iso))
export const formatWeekday = (ms: number) => weekdayFmt.format(new Date(ms))

/** "Today", "Yesterday", "3 days ago", then the date. */
export function relativeDay(iso: string, now = DEMO_NOW) {
  const d = Math.floor((now - new Date(iso).getTime()) / DAY_MS + 0.5)
  if (d <= 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 7) return `${d} days ago`
  return formatDate(iso)
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`

export const countryName = (code: string) => countries[code as CountryCode]?.name ?? code

/* ---------- Order tabs and statuses ---------- */

export type OrderTab = "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "refund_requested" | "all"

export const orderTabs: { value: OrderTab; label: string }[] = [
  { value: "paid", label: "To fulfil" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refund_requested", label: "Refund requested" },
  { value: "all", label: "All" },
]

export const emptyOrderTab: Record<OrderTab, { title: string; body: string }> = {
  paid: { title: "Nothing to fulfil", body: "New paid orders land here. Mark them as processing when you start packing." },
  processing: { title: "Nothing in processing", body: "Orders you're packing wait here until you add tracking." },
  shipped: { title: "Nothing in transit", body: "Orders with tracking show here until they're delivered." },
  delivered: { title: "No deliveries yet", body: "Delivered orders show here. Payouts follow once the returns window closes." },
  cancelled: { title: "No cancelled orders", body: "Orders cancelled before shipping show here, with the reason." },
  refund_requested: { title: "No refund requests", body: "When a customer asks for a refund, it waits here for your decision." },
  all: { title: "No orders yet", body: "When a customer pays for one of your products, the order appears here." },
}

export function orderMatchesTab(o: MerchantOrder, tab: OrderTab) {
  return tab === "all" || o.status === tab
}

/** Orders can be cancelled by the brand only before they ship. */
export const cancellable = (s: MerchantOrderStatus) => s === "paid" || s === "processing"

type Tone = "neutral" | "info" | "attention" | "success" | "danger" | "muted"

/**
 * What the shopper's money did. A cancelled or refunded order was refunded in full, even if the
 * stored payment status hasn't caught up yet (the provider's refund webhook sets it in the backend).
 */
export function paymentState(o: Pick<MerchantOrder, "status" | "paymentStatus">): PaymentStatus {
  if (o.status === "refunded" || o.status === "cancelled") return "refunded"
  return o.paymentStatus
}

export const paymentMeta: Record<PaymentStatus, { label: string; tone: Tone }> = {
  captured: { label: "Paid", tone: "success" },
  authorized: { label: "Authorised", tone: "info" },
  pending: { label: "Awaiting payment", tone: "muted" },
  failed: { label: "Failed", tone: "danger" },
  refunded: { label: "Refunded", tone: "muted" },
  partially_refunded: { label: "Partly refunded", tone: "attention" },
}

export const itemCount = (o: MerchantOrder) => o.lines.reduce((s, l) => s + l.quantity, 0)

/** The last day the order should leave the studio, from the brand's processing time. */
export function shipBy(o: MerchantOrder, processingDays: [number, number]) {
  return new Date(o.placedAt).getTime() + processingDays[1] * DAY_MS
}

/* ---------- Payout estimate ---------- */

/** Subtotal minus the 5% commission. Shipping and tax are not part of the brand's earnings here. */
export function payoutEstimate(o: MerchantOrder) {
  const voided = o.status === "cancelled" || o.status === "refunded"
  const commission = o.commission || Math.round(o.subtotal * COMMISSION_RATE)
  return { subtotal: o.subtotal, commission, payout: voided ? 0 : o.subtotal - commission, voided }
}

/* ---------- Refund requests (sample reasons in the frontend phase) ---------- */

const REFUND_REASONS = [
  { reason: "Size too small", note: "The fit runs smaller than the size chart. I'd like to send it back." },
  { reason: "Not as described", note: "The colour is much darker than in the photos." },
  { reason: "Damaged in transit", note: "The parcel arrived torn and the print is scuffed on the back." },
  { reason: "Changed my mind", note: "Ordered two of the same by mistake." },
] as const

export function refundRequest(o: MerchantOrder) {
  return pick(`refund-${o.id}`, REFUND_REASONS)
}

/* ---------- Fulfilment ---------- */

export const carriersFor = (country: CountryCode) => {
  const local: Partial<Record<CountryCode, string[]>> = {
    NG: ["GIG Logistics", "Kwik Delivery", "DHL Express"],
    GH: ["Ghana Post EMS", "DHL Express"],
    KE: ["Sendy", "G4S Courier", "DHL Express"],
    ZA: ["The Courier Guy", "DHL Express"],
    GB: ["Royal Mail", "DPD", "DHL Express"],
    KR: ["CJ Logistics", "DHL Express"],
    JP: ["Yamato Transport", "DHL Express"],
  }
  const list = [...(local[country] ?? []), "DHL Express", "UPS", "FedEx", "Aramex"]
  return [...new Set(list)]
}

export function trackingError(raw: string) {
  const v = raw.trim()
  if (!v) return "Enter the tracking number from the carrier's receipt."
  if (/\s/.test(v)) return "Tracking numbers don't contain spaces."
  if (!/^[A-Za-z0-9-]+$/.test(v)) return "Use only letters, numbers and dashes."
  if (v.length < 6) return "That's too short for a tracking number. Check the receipt."
  if (v.length > 34) return "That's too long for a tracking number. Check the receipt."
  return undefined
}

/* ---------- Customers (derived from this brand's orders only) ---------- */

export type Segment = "new" | "repeat" | "vip"

export const segmentMeta: Record<Segment, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "neutral" },
  repeat: { label: "Repeat", tone: "info" },
  // Acid stays for statuses that ask the brand to act; VIP is a standing, not a task.
  vip: { label: "VIP", tone: "success" },
}

/** VIP: spent at least this much with the brand (USD cents, converted to the brand currency). */
export const VIP_SPEND_USD = 30_000

export type BrandCustomer = {
  id: string
  name: string
  city: string
  country: CountryCode
  orders: MerchantOrder[]
  /** Orders that went through (refunded ones included, cancelled ones not): what the segment counts. */
  orderCount: number
  /** Orders cancelled before shipping. Listed in the history, never counted. */
  cancelledCount: number
  /** Orders that went through (not cancelled or refunded): what "spent" is made of. */
  paidCount: number
  spent: number
  firstOrderAt: string
  lastOrderAt: string
  segment: Segment
}

const shopperById = new Map<string, ShopperProfile>(shoppers.map((s) => [s.id, s]))
export const shopperName = (id: string) => shopperById.get(id)?.name ?? "Customer"

export function vipThreshold(currency: CurrencyCode) {
  return convert(VIP_SPEND_USD, "USD", currency)
}

/** The Customers page header copy, shared by the page and its loading state so nothing shifts. */
export const customersDescription = (brandName: string) =>
  `People who have bought from ${brandName}, built from your orders. You see what you need to serve them: name, where they ship to and their orders with you.`

export function buildCustomers(orders: MerchantOrder[], currency: CurrencyCode): BrandCustomer[] {
  const vip = vipThreshold(currency)
  const byId = new Map<string, MerchantOrder[]>()
  for (const o of orders) {
    if (o.status === "pending_payment") continue
    const list = byId.get(o.customerId)
    if (list) list.push(o)
    else byId.set(o.customerId, [o])
  }
  return [...byId.entries()].map(([id, list]) => {
    const sorted = [...list].sort((a, b) => b.placedAt.localeCompare(a.placedAt))
    const placed = sorted.filter((o) => o.status !== "cancelled")
    const counted = placed.filter((o) => o.status !== "refunded")
    const spent = counted.reduce((s, o) => s + o.total, 0)
    const profile = shopperById.get(id)
    const last = sorted[0]
    const segment: Segment = spent >= vip ? "vip" : placed.length >= 2 ? "repeat" : "new"
    return {
      id,
      name: profile?.name ?? last.shippingAddress.name,
      city: profile?.city ?? last.shippingAddress.city,
      country: profile?.country ?? last.shippingAddress.country,
      orders: sorted,
      orderCount: placed.length,
      cancelledCount: sorted.length - placed.length,
      paidCount: counted.length,
      spent,
      firstOrderAt: sorted[sorted.length - 1].placedAt,
      lastOrderAt: last.placedAt,
      segment,
    }
  })
}

/* ---------- Analytics helpers ---------- */

/** Returning customer rate: customers in the window with 2+ lifetime orders ÷ customers who ordered in the window. */
export function returningRate(orders: MerchantOrder[], fromMs: number, toMs = DEMO_NOW + DAY_MS) {
  const live = orders.filter((o) => o.status !== "cancelled" && o.status !== "pending_payment")
  const lifetime = new Map<string, number>()
  for (const o of live) lifetime.set(o.customerId, (lifetime.get(o.customerId) ?? 0) + 1)
  const inWindow = new Set(live.filter((o) => {
    const t = new Date(o.placedAt).getTime()
    return t >= fromMs && t < toMs
  }).map((o) => o.customerId))
  const returning = [...inWindow].filter((id) => (lifetime.get(id) ?? 0) >= 2).length
  return { customers: inWindow.size, returning, rate: inWindow.size ? returning / inWindow.size : 0 }
}

/** Stable 0–1 noise for sample funnel steps. */
export const noise = (key: string) => (hash(key) % 1000) / 1000
