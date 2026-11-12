import "server-only"
import { site } from "@/config/site"
import type { BRAND_TIERS } from "../db/schema/ledger"

/**
 * Finance rules (LEDGER). Commission comes from the site config (site.commissionRate, 3.5%; 0% during the launch
 * offer, see src/lib/commission.ts) unless an admin set a per-brand override. Reserves depend on the brand's tier.
 */
export type BrandTier = (typeof BRAND_TIERS)[number]

export const ledgerConfig = {
  /** Basis points of the captured gross taken as commission (3.5% → 350). */
  commissionBps: Math.round(site.commissionRate * 10_000),
  /** Rolling reserve by tier: a share of the brand's net held for `days` after the order completes. */
  reserves: {
    new: { bps: 1000, days: 30 },
    standard: { bps: 500, days: 14 },
    trusted: { bps: 0, days: 0 },
  } satisfies Record<BrandTier, { bps: number; days: number }>,
  /** A brand becomes "trusted" when verified with at least this many completed orders. */
  trustedAfterCompletedOrders: 50,
  /** Smallest payout a brand can request, per currency in minor units (default for unlisted currencies). */
  minPayoutMinor: { NGN: 500_000, KES: 50_000, GHS: 5_000, ZAR: 10_000, USD: 1_000, GBP: 1_000, EUR: 1_000 } as Record<string, number>,
  defaultMinPayoutMinor: 1_000,
  /** Payout requests are refused this long after the bank account changed (account-takeover guard). */
  bankChangeCooldownHours: 24,
  /** Re-authentication window for money actions (approve, run batch, adjust, change bank account). */
  reauthMaxAgeSec: 10 * 60,
  /** A payout still 'sending' or 'processing' this long is flagged by reconciliation. */
  stuckPayoutHours: 48,
  /** Reconciliation looks back this far each day (overlapping windows catch late provider events). */
  reconWindowHours: 48,
} as const

export const minPayoutFor = (currency: string) => ledgerConfig.minPayoutMinor[currency] ?? ledgerConfig.defaultMinPayoutMinor

/** Brand roles that can read balances and the statement / request payouts / change the bank account. */
export const FINANCE_VIEW_ROLES = ["owner", "admin", "finance"] as const
export const FINANCE_REQUEST_ROLES = ["owner", "admin", "finance"] as const
export const BANK_ACCOUNT_ROLES = ["owner"] as const
/** Admin roles that can see Admin › Finance and approve / run payouts. */
export { ADMIN_FINANCE_ROLES } from "@/lib/permissions"
