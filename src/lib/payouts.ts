import { site } from "@/config/site"
import type { CurrencyCode } from "@/config/markets"
import { payoutAmountIn, type Payout } from "@/lib/data/admin"
import type { MerchantOrder } from "@/lib/data/types"

/**
 * A brand's payout balances, derived from its orders and payout records. The single source
 * for every place that shows these figures (the Payouts page, the Studio sidebar card and each
 * order's payout estimate), so the numbers can never disagree.
 */

/** Delivered orders stay in the returns window this many days before they can be paid out. */
export const PAYOUT_HOLD_DAYS = 7
/** The prototype's fixed "today", so the hold window is stable between server and client. */
export const PAYOUT_TODAY = new Date("2026-11-05T12:00:00Z").getTime()
export const COMMISSION_RATE = site.commissionRate

/* ---------- Refunds ---------- */

/**
 * What approving a return gives back: the returned lines (every line when none are named), and
 * the refund in the order currency. Returning everything refunds what was paid, shipping
 * included; returning part refunds those items. Commission comes back on the returned items.
 */
export function returnRefund(o: Pick<MerchantOrder, "lines" | "total" | "commission" | "subtotal">, variantIds?: string[]) {
  const named = variantIds?.length ? o.lines.filter((l) => variantIds.includes(l.variantId)) : []
  const lines = named.length ? named : o.lines
  const partial = lines.length < o.lines.length
  const itemsSubtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  const commission = o.commission || Math.round(o.subtotal * COMMISSION_RATE)
  return {
    lines,
    variantIds: lines.map((l) => l.variantId),
    /** Pieces coming back (quantities, not lines), as the order's item count reads. */
    units: lines.reduce((s, l) => s + l.quantity, 0),
    partial,
    /** What the shopper gets back. */
    amount: partial ? itemsSubtotal : o.total,
    itemsSubtotal,
    commissionBack: partial ? Math.round(itemsSubtotal * COMMISSION_RATE) : commission,
  }
}

/**
 * What a partial refund took back from a delivered order: the refunded lines, and the commission
 * that comes back on them. Reads the order's recorded refund; orders saved before refunds were
 * recorded fall back to the lines on the shopper's return request.
 */
export function partialRefund(o: Pick<MerchantOrder, "lines" | "paymentStatus" | "returnRequest" | "refund">) {
  const ids = o.refund?.variantIds ?? (o.paymentStatus === "partially_refunded" ? o.returnRequest?.variantIds : undefined)
  if (!ids || o.paymentStatus !== "partially_refunded") return null
  const lines = o.lines.filter((l) => ids.includes(l.variantId))
  if (!lines.length || lines.length === o.lines.length) return null
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
  return { lines, subtotal, amount: o.refund?.amount ?? subtotal, commissionBack: Math.round(subtotal * COMMISSION_RATE) }
}

/**
 * One order's earnings: the item subtotal minus the 5% commission. Shipping and tax are not part
 * of the brand's earnings. A partial refund takes the returned items off, net of the commission
 * that comes back on them; a cancelled or fully refunded order earns nothing.
 */
export function orderEarnings(o: MerchantOrder) {
  const voided = o.status === "cancelled" || o.status === "refunded"
  const commission = o.commission || Math.round(o.subtotal * COMMISSION_RATE)
  const refunded = voided ? null : partialRefund(o)
  const payout = voided ? 0 : o.subtotal - commission - (refunded ? refunded.subtotal - refunded.commissionBack : 0)
  return { subtotal: o.subtotal, commission, payout, voided, refunded }
}

/* ---------- Balances ---------- */

export type PayoutBalances = {
  /** Delivered orders past the hold window, after commission and partial refunds, minus payouts already requested. */
  available: number
  /**
   * Orders in flight, delivered within the hold window, or with a return being decided (held
   * until the decision: approving refunds some or all of it, declining releases it).
   */
  pending: number
  /** What of `pending` is held while a return on the order is decided. */
  heldForReturns: number
  /** How many delivered orders past the hold window the available balance comes from. */
  eligibleOrders: number
  inReview: number
  processing: number
  paid: number
}

export function payoutBalances(orders: MerchantOrder[], payouts: Payout[], brandId: string, currency: CurrencyCode): PayoutBalances {
  const mine = payouts.filter((p) => p.brandId === brandId)
  const net = (o: MerchantOrder) => orderEarnings(o).payout
  const age = (o: MerchantOrder) => (PAYOUT_TODAY - new Date(o.placedAt).getTime()) / 86_400_000
  const delivered = orders.filter((o) => o.status === "delivered")
  const cleared = delivered.filter((o) => age(o) >= PAYOUT_HOLD_DAYS)
  const eligible = cleared.reduce((s, o) => s + net(o), 0)
  const holding = delivered.filter((o) => age(o) < PAYOUT_HOLD_DAYS).reduce((s, o) => s + net(o), 0)
  const inFlight = orders.filter((o) => ["paid", "processing", "shipped"].includes(o.status)).reduce((s, o) => s + net(o), 0)
  const heldForReturns = orders.filter((o) => o.status === "refund_requested").reduce((s, o) => s + net(o), 0)
  const sum = (list: Payout[]) => list.reduce((s, p) => s + payoutAmountIn(p, currency), 0)
  const inReview = sum(mine.filter((p) => p.status === "awaiting_approval" || p.status === "held"))
  const processing = sum(mine.filter((p) => p.status === "processing" || p.status === "scheduled"))
  const paid = sum(mine.filter((p) => p.status === "paid"))
  const committed = inReview + processing + paid
  return { available: Math.max(0, eligible - committed), pending: holding + inFlight + heldForReturns, heldForReturns, eligibleOrders: cleared.length, inReview, processing, paid }
}
