import { currencies, type CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"

/**
 * Formatting for the orders and finance screens, in UTC. Sample rows are dated relative to the
 * demo's reference day; a record made in this browser carries the real time it was made (see
 * isLiveTime). Relative labels ("Today", "Tomorrow") count every row from one today, so a sample
 * row and a record made here, side by side in one column, agree on which day is today: the demo's
 * on the server and while hydrating, the real one once the client knows the time (see demoLag).
 */

export const DEMO_NOW = new Date("2026-11-05T12:00:00Z").getTime()
const DAY = 86_400_000
const utcDay = (t: number) => Math.floor(t / DAY)

/**
 * Whether a record was made in this browser (a Studio payout request, a shopper's return, an
 * adjustment or a decision) rather than shipped with the sample data. Sample rows sit on or before
 * the demo's today, or at exactly noon UTC on a day relative to it (a payout scheduled two days
 * out, evidence due next week); a record made here carries the real time, after the demo's today.
 * Live records only exist once the stores rehydrate on the client, never in the server HTML.
 */
export function isLiveTime(iso: string) {
  const t = new Date(iso).getTime()
  return t > DEMO_NOW && (t - DAY / 2) % DAY !== 0
}

/**
 * Whole days (UTC) the real today is past the demo's, once the client knows the time (`now`,
 * useNow's reading); 0 on the server and while hydrating, where `now` is null, so the prerendered
 * HTML never changes. A sample row's count from the demo's today moves on by this much, so it is
 * counted from the same today as a record made here. Only the relative label moves: stored dates
 * stay as they are.
 */
export function demoLag(now?: number | null) {
  return now == null ? 0 : Math.max(0, utcDay(now) - utcDay(DEMO_NOW))
}

/**
 * The calendar day (UTC, "2026-11-05") every Control Center page counts as today: the demo's on
 * the server and while hydrating, the real one once the client knows the time. Windows such as
 * "30 days" end on it, so the Overview and the Orders page count the same days.
 */
export function anchorDay(now?: number | null) {
  return new Date(DEMO_NOW + demoLag(now) * DAY).toISOString().slice(0, 10)
}

/** The moment a sample record's age is measured from: the demo's now, moved on by demoLag. */
export function sampleNow(now?: number | null) {
  return DEMO_NOW + demoLag(now) * DAY
}

/**
 * Sample records carry a day only (stored at noon UTC); a time of "12:00 UTC" on every one of
 * them would be false precision, so they show the date alone. Records made here keep their time.
 */
export const isDayPrecision = (iso: string) => new Date(iso).getTime() % DAY === DAY / 2

/**
 * Whole days before today that `iso` falls on (negative for a later day): calendar days (UTC) from
 * the real clock for a live record, from the demo's today moved on by demoLag for a sample row.
 */
function daysAgo(iso: string, now?: number | null) {
  const t = new Date(iso).getTime()
  return isLiveTime(iso) ? utcDay(now ?? Date.now()) - utcDay(t) : Math.floor((DEMO_NOW - t) / DAY) + demoLag(now)
}

/**
 * "Today", "Yesterday", "4 days ago". Pass useNow's reading as `now` wherever a column can hold
 * records made here, so every row counts from the same today and the label moves on while the
 * page is open.
 */
export function relDays(iso: string, now?: number | null) {
  const d = daysAgo(iso, now)
  if (d <= 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 31) return `${d} days ago`
  const m = Math.round(d / 30)
  return m <= 1 ? "A month ago" : `${m} months ago`
}

/** Whole days until `iso` (negative when it has passed), counted from the same today as relDays. */
export function daysUntil(iso: string, now?: number | null) {
  const t = new Date(iso).getTime()
  return isLiveTime(iso) ? utcDay(t) - utcDay(now ?? Date.now()) : Math.ceil((t - DEMO_NOW) / DAY) - demoLag(now)
}

export function dueLabel(iso: string, now?: number | null) {
  const d = daysUntil(iso, now)
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
/** The date alone for a day-precision sample record, the date and time for anything else. */
export const formatWhen = (iso: string) => (isDayPrecision(iso) ? formatDate(iso) : formatDateTime(iso))

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
