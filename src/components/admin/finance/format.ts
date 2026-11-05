import { currencies, type CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"

/**
 * Formatting for the orders and finance screens. Dates are relative to the demo's reference
 * day and formatted in UTC, so the prerendered HTML and the client always agree.
 */

export const DEMO_NOW = new Date("2026-11-05T12:00:00Z").getTime()
const DAY = 86_400_000

export function relDays(iso: string) {
  const d = Math.floor((DEMO_NOW - new Date(iso).getTime()) / DAY)
  if (d <= 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 31) return `${d} days ago`
  const m = Math.round(d / 30)
  return m <= 1 ? "A month ago" : `${m} months ago`
}

/** Whole days from the demo's today until `iso` (negative when it has passed). */
export function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - DEMO_NOW) / DAY)
}

export function dueLabel(iso: string) {
  const d = daysUntil(iso)
  if (d < 0) return `Overdue by ${plural(-d, "day")}`
  if (d === 0) return "Due today"
  if (d === 1) return "Due tomorrow"
  return `Due in ${d} days`
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })

export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatDay = (iso: string) => dayFmt.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso))
export const formatDateTime = (iso: string) => `${dateTimeFmt.format(new Date(iso))} UTC`

/** USD in cents, always with cents so a column of figures lines up. */
export const usd = (cents: number) => formatMoney(Math.round(cents), "USD", { showCents: true })
export const usdCompact = (cents: number) => formatMoney(Math.round(cents), "USD", { compact: true })
/** Compact from $1,000 up; exact below, where "$334.3" would read as a typo. */
export const usdShort = (cents: number) => (Math.abs(cents) >= 100_000 ? usdCompact(cents) : usd(cents))
/** Signed USD for ledger lines: credits to the brand are +, debits −. */
export const signedUsd = (cents: number) => `${cents < 0 ? "−" : "+"}${usd(Math.abs(cents))}`

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const providerName: Record<string, string> = { paystack: "Paystack", flutterwave: "Flutterwave", stripe: "Stripe", internal: "Ledger" }

const digits = new Map<number, Intl.NumberFormat>()

/**
 * An amount in its original currency for operators: the currency's own symbol (MX$, not a bare
 * $) and the same digit grouping in every currency, so a column of mixed currencies reads cleanly.
 */
export function amountIn(amount: number, currency: CurrencyCode) {
  if (currency === "USD") return usd(amount)
  const c = currencies[currency]
  let f = digits.get(c.minor)
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: c.minor, maximumFractionDigits: c.minor })
    digits.set(c.minor, f)
  }
  const major = amount / 10 ** c.minor
  return `${major < 0 ? "−" : ""}${c.symbol}${f.format(Math.abs(major))}`
}
