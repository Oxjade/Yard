import { currencies, type CurrencyCode } from "@/config/markets"
import { DEMO_TODAY } from "@/lib/data/seed"
import { formatMoney } from "@/lib/money"

/**
 * Dates on the shopper's own pages. Sample data is dated relative to the demo's
 * reference day (as Studio does), so "3 days ago" stays true whenever the prototype
 * is opened. Formatting pins the UTC zone so every render agrees.
 */
export const DEMO_NOW = new Date(`${DEMO_TODAY}T12:00:00Z`).getTime()
const DAY = 86_400_000

export function daysSince(iso: string) {
  return Math.floor((DEMO_NOW - new Date(iso).getTime()) / DAY)
}

export function formatDay(iso: string, opts: { year?: boolean; weekday?: boolean } = {}) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: opts.year ? "numeric" : undefined,
    weekday: opts.weekday ? "short" : undefined,
    timeZone: "UTC",
  })
}

export function relativeDay(iso: string) {
  const d = daysSince(iso)
  if (d <= 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 7) return `${d} days ago`
  return formatDay(iso)
}

/** Buckets for grouping a feed or a history list. */
export function dayBucket(iso: string) {
  const d = daysSince(iso)
  if (d <= 0) return "Today"
  if (d < 7) return "This week"
  if (d < 14) return "Last week"
  if (d < 31) return "Earlier this month"
  return "Earlier"
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

/** Only same-site paths are followed after sign-in. */
export function safeNext(next: string | null | undefined, fallback = "/you") {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback
  return next
}

/**
 * An amount in an order's own currency. The Mexican peso's narrow sign is a bare "$", which next
 * to a shopper browsing in US dollars reads as USD, so any non-USD dollar amount carries its own
 * symbol ("MX$6,822.40"). Other currencies already have a distinct sign.
 */
export function formatOrderMoney(amount: number, currency: CurrencyCode) {
  const s = formatMoney(amount, currency)
  if (currency === "USD") return s
  const symbol = currencies[currency].symbol
  return s.includes("$") && !s.includes(symbol) ? s.replace("$", symbol) : s
}
