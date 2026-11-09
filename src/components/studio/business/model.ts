import { holidays } from "@/config/holidays"
import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { countryTimeZone } from "@/lib/data/zones"
import { addBusinessDays, makeCalendar, noonUtc, orderDay, WEEKDAYS } from "@/lib/shipping/calendar"
import { demoCustomer, sampleReturnRequest, shoppers, type ShopperProfile } from "@/lib/data/orders"
import { DEMO_TODAY, hash } from "@/lib/data/seed"
import { convert } from "@/lib/money"
import { COMMISSION_RATE, orderEarnings, partialRefund, returnRefund } from "@/lib/payouts"
import type { MerchantOrder, MerchantOrderStatus, PaymentStatus } from "@/lib/data/types"

/**
 * Rules for the Studio business pages, kept pure so the backend phase can reuse them
 * (as server-side queries) without touching the pages.
 */

/** The demo's "now" — the sample orders are placed relative to it. */
export const DEMO_NOW = new Date(`${DEMO_TODAY}T12:00:00Z`).getTime()
export const DAY_MS = 86_400_000
export { COMMISSION_RATE, partialRefund }

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

export type OrderTab = "paid" | "processing" | "shipped" | "delivered" | "refund_requested" | "refunded" | "cancelled" | "pending_payment" | "all"

/** Tabs that only show while they hold orders, so the bar stays short for most brands. */
export const conditionalOrderTabs = new Set<OrderTab>(["refunded", "pending_payment"])

export const orderTabs: { value: OrderTab; label: string }[] = [
  { value: "paid", label: "To fulfil" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "refund_requested", label: "Refund requested" },
  { value: "refunded", label: "Refunded" },
  { value: "cancelled", label: "Cancelled" },
  { value: "pending_payment", label: "Awaiting payment" },
  { value: "all", label: "All" },
]

export const emptyOrderTab: Record<OrderTab, { title: string; body: string }> = {
  paid: { title: "Nothing to fulfil", body: "New paid orders land here. Mark them as processing when you start packing." },
  processing: { title: "Nothing in processing", body: "Orders you're packing wait here until you add tracking." },
  shipped: { title: "Nothing in transit", body: "Orders with tracking show here until they're delivered." },
  delivered: { title: "No deliveries yet", body: "Delivered orders show here. Payouts follow once the returns window closes." },
  refund_requested: { title: "No refund requests", body: "When a customer asks to return an order, it waits here for your decision." },
  refunded: { title: "No refunds", body: "Orders you refund show here." },
  cancelled: { title: "No cancelled orders", body: "Orders cancelled before shipping show here, with the reason." },
  pending_payment: { title: "Nothing awaiting payment", body: "Orders placed at checkout wait here until the payment provider confirms them." },
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

/**
 * The payment badge for an order. A refund approved in this browser (on a return, or by cancelling
 * a paid order) is recorded but not sent, since no payment provider is connected, so it says so.
 */
export function paymentView(o: Pick<MerchantOrder, "status" | "paymentStatus" | "refund" | "cancelReason">): { label: string; tone: Tone } {
  const state = paymentState(o)
  if (state === "partially_refunded" && o.refund) return { label: "Partial refund recorded", tone: "info" }
  if (state === "refunded" && (o.refund || (o.status === "cancelled" && o.cancelReason && o.paymentStatus === "refunded"))) return { label: "Refund recorded", tone: "muted" }
  return paymentMeta[state]
}

export const itemCount = (o: MerchantOrder) => o.lines.reduce((s, l) => s + l.quantity, 0)

/**
 * The last day the order should leave the studio (noon UTC on that date), in business days from
 * the order day: weekends and the origin's public holidays don't count, and an order after the
 * 14:00 cutoff counts from the next business day (§6.5). Yard's server estimate, when Studio has
 * one, takes precedence (it also knows the brand's closures).
 */
export function shipBy(o: MerchantOrder, processingDays: [number, number]) {
  const origin = brandById.get(o.brandId)?.shipsFrom ?? "NG"
  const list = holidays[origin as keyof typeof holidays] ?? []
  const cal = makeCalendar(WEEKDAYS, list.map((h) => h.date))
  const d0 = orderDay(Date.parse(o.placedAt), { timeZone: countryTimeZone[origin], cutoffLocal: "14:00" }, cal)
  return noonUtc(addBusinessDays(d0, processingDays[1], cal))
}

/* ---------- Payout estimate ---------- */

/**
 * Subtotal minus the 5% commission. Shipping and tax are not part of the brand's earnings here.
 * A partial refund takes the returned items off, net of the commission that comes back on them.
 * The same figure the Payouts page and the sidebar card add up (lib/payouts).
 */
export const payoutEstimate = (o: MerchantOrder) => orderEarnings(o)

/* ---------- Refund requests ---------- */

export type RefundRequestView = {
  reason: string
  note?: string
  at: string
  /** The order lines the customer wants to return. */
  lines: MerchantOrder["lines"]
  /** What the returned lines cost the customer. */
  amount: number
  /** True when it came from the sample data rather than a request made in this browser. */
  sample: boolean
}

/** The shopper's return request on an order: the real one when they made it here, else the sample one. */
export function refundRequest(o: MerchantOrder): RefundRequestView {
  const r = o.returnRequest
  if (r) {
    // Returning everything refunds what was paid, shipping included.
    const refund = returnRefund(o, r.variantIds)
    return { reason: r.reasonLabel, note: r.note, at: r.at, lines: refund.lines, amount: refund.amount, sample: false }
  }
  // The sample request Finance's refund queue shows too, and a decision records on the order.
  const s = sampleReturnRequest(o)
  return { reason: s.reasonLabel, note: s.note, at: s.at, lines: o.lines, amount: o.total, sample: true }
}

/* ---------- Fulfilment ---------- */

/** The carriers offered for a ship-from country (the general list alone when it isn't known). */
export const carriersFor = (country: CountryCode | null) => {
  const local: Partial<Record<CountryCode, string[]>> = {
    NG: ["GIG Logistics", "Kwik Delivery", "DHL Express"],
    GH: ["Ghana Post EMS", "DHL Express"],
    KE: ["Sendy", "G4S Courier", "DHL Express"],
    ZA: ["The Courier Guy", "DHL Express"],
    GB: ["Royal Mail", "DPD", "DHL Express"],
    KR: ["CJ Logistics", "DHL Express"],
    JP: ["Yamato Transport", "DHL Express"],
  }
  const list = [...((country && local[country]) || []), "DHL Express", "UPS", "FedEx", "Aramex"]
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

const shopperById = new Map<string, ShopperProfile>([...shoppers.map((s) => [s.id, s] as const), [demoCustomer.id, { id: demoCustomer.id, name: demoCustomer.name, email: demoCustomer.email, city: demoCustomer.city, country: demoCustomer.country }]])
export const shopperName = (id: string) => shopperById.get(id)?.name ?? "Customer"
/** The customer's name on an order: their profile, else the name the order ships to (a checkout order from someone new). */
export const orderCustomerName = (o: Pick<MerchantOrder, "customerId" | "shippingAddress">) => shopperById.get(o.customerId)?.name ?? o.shippingAddress.name

export function vipThreshold(currency: CurrencyCode) {
  return convert(VIP_SPEND_USD, "USD", currency)
}

/** The Orders header copy, shared by the page and its loading state so nothing shifts. */
export const ordersDescription = (brandName: string) => `Every order for ${brandName}, newest first. Ship an order once it shows Paid: that means the payment provider confirmed it.`

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
