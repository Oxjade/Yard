import { convert } from "@/lib/money"
import type { CurrencyCode } from "@/config/markets"
import type { Payout } from "@/lib/data/admin"
import type { MerchantOrder } from "@/lib/data/types"

/**
 * A brand's payout balances, derived from its orders and payout records. The single source
 * for every place that shows these figures (the Payouts page and the Studio sidebar card),
 * so the numbers can never disagree.
 */

/** Delivered orders stay in the returns window this many days before they can be paid out. */
export const PAYOUT_HOLD_DAYS = 7
/** The prototype's fixed "today", so the hold window is stable between server and client. */
export const PAYOUT_TODAY = new Date("2026-11-05T12:00:00Z").getTime()

export type PayoutBalances = {
  /** Delivered orders past the hold window, after commission, minus payouts already requested. */
  available: number
  /** Orders in flight, or delivered within the hold window. */
  pending: number
  inReview: number
  processing: number
  paid: number
}

export function payoutBalances(orders: MerchantOrder[], payouts: Payout[], brandId: string, currency: CurrencyCode): PayoutBalances {
  const mine = payouts.filter((p) => p.brandId === brandId)
  const net = (o: MerchantOrder) => o.subtotal - o.commission
  const age = (o: MerchantOrder) => (PAYOUT_TODAY - new Date(o.placedAt).getTime()) / 86_400_000
  const delivered = orders.filter((o) => o.status === "delivered")
  const eligible = delivered.filter((o) => age(o) >= PAYOUT_HOLD_DAYS).reduce((s, o) => s + net(o), 0)
  const holding = delivered.filter((o) => age(o) < PAYOUT_HOLD_DAYS).reduce((s, o) => s + net(o), 0)
  const inFlight = orders.filter((o) => ["paid", "processing", "shipped"].includes(o.status)).reduce((s, o) => s + net(o), 0)
  const inReview = mine.filter((p) => p.status === "awaiting_approval" || p.status === "held").reduce((s, p) => s + convert(p.amountUsd, "USD", currency), 0)
  const processing = mine.filter((p) => p.status === "processing" || p.status === "scheduled").reduce((s, p) => s + convert(p.amountUsd, "USD", currency), 0)
  const paid = mine.filter((p) => p.status === "paid").reduce((s, p) => s + convert(p.amountUsd, "USD", currency), 0)
  const committed = inReview + processing + paid
  return { available: Math.max(0, eligible - committed), pending: holding + inFlight, inReview, processing, paid }
}
