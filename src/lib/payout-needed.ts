import { currencies, type CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"

/**
 * "Add your payout account" (docs/BRAND-EMAILS.md › Payout account needed). A brand can sell
 * without a payout account; Yard holds what it earns in the ledger until it adds one. These are the
 * pure rules shared by the email (server/ledger/payout-needed-db.ts), the Studio banner and Admin.
 */

const HOUR = 3600_000

/** At most one payout-needed email per brand in any 24 hours, however many orders come in. */
export const PAYOUT_NEEDED_COOLDOWN_MS = 24 * HOUR
/** One reminder this long after the first sale made without a payout account. */
export const PAYOUT_REMINDER_AFTER_MS = 72 * HOUR
export const PAYOUT_NEEDED_TEMPLATE = "brand_payout_needed"
export const PAYOUT_SETTINGS_PATH = "/studio/settings#payouts"

/** One currency of a brand's ledger balances (BrandBalanceDto). */
export type OwedBalance = { currency: string; pendingMinor: number; availableMinor: number; reserveMinor: number; inPayoutMinor: number }
export type Owed = { currency: string; minor: number }

/** What Yard owes the brand in one currency: pending + available + reserve + in payout (the reconciliation's "owed to brands"). */
export const owedMinor = (b: OwedBalance) => b.pendingMinor + b.availableMinor + b.reserveMinor + b.inPayoutMinor

/** The currencies Yard owes the brand something in, the brand's own currency first. */
export function owedList(balances: readonly OwedBalance[], brandCurrency?: string): Owed[] {
  return balances
    .map((b) => ({ currency: b.currency, minor: owedMinor(b) }))
    .filter((o) => o.minor > 0)
    .sort((a, b) => (a.currency === brandCurrency ? -1 : b.currency === brandCurrency ? 1 : a.currency.localeCompare(b.currency)))
}

const money = (o: Owed) => (o.currency in currencies ? formatMoney(o.minor, o.currency as CurrencyCode) : `${(o.minor / 100).toFixed(2)} ${o.currency}`)

/** "₦45,000", or "₦45,000 + $20" when the brand earned in more than one currency. */
export const formatOwed = (owed: readonly Owed[]) => owed.map(money).join(" + ")

/** The UTC day of `now`, for the outbox dedupe key `payout_needed:{brandId}:{yyyy-mm-dd}`. */
export const payoutNeededDedupeKey = (brandId: string, now: Date, kind: "sale" | "reminder" = "sale") =>
  kind === "reminder" ? `payout_needed:reminder:${brandId}` : `payout_needed:${brandId}:${now.toISOString().slice(0, 10)}`

/** Whether the 24-hour window since the last payout-needed email has passed. */
export const payoutEmailDue = (lastEmailedAt: Date | null, now: Date) => !lastEmailedAt || now.getTime() - lastEmailedAt.getTime() >= PAYOUT_NEEDED_COOLDOWN_MS

/** The one reminder: still no account, 3 days after the first unpaid-out sale, never reminded, and outside the 24-hour window. */
export function payoutReminderDue(b: { since: Date | null; remindedAt: Date | null; emailedAt: Date | null; hasAccount: boolean }, now: Date): boolean {
  if (b.hasAccount || !b.since || b.remindedAt) return false
  return now.getTime() - b.since.getTime() >= PAYOUT_REMINDER_AFTER_MS && payoutEmailDue(b.emailedAt, now)
}

/**
 * The Studio banner (Overview and Payouts) from the payouts summary: shown when the brand has
 * earnings and no payout account. Only the owner can add the account (ledger BANK_ACCOUNT_ROLES),
 * so admins and finance are told to ask them.
 */
export type PayoutNeededBanner = { owed: Owed[]; title: string; body: string; action: { label: string; href: string } | null }

export function payoutNeededBanner(summary: { currency: string; balances: readonly OwedBalance[]; account: unknown } | null | undefined, role?: string): PayoutNeededBanner | null {
  if (!summary || summary.account) return null
  const owed = owedList(summary.balances, summary.currency)
  if (!owed.length) return null
  const owner = !role || role === "owner"
  return {
    owed,
    title: `You have ${formatOwed(owed)} waiting. Add your payout account to get paid.`,
    body: owner
      ? "Yard is holding your earnings safely. Add the bank account they should go to, it takes about 2 minutes."
      : "Yard is holding your earnings safely. Only the brand owner can add the payout account, so give them a nudge.",
    action: owner ? { label: "Add payout account", href: PAYOUT_SETTINGS_PATH } : null,
  }
}
