import { z } from "zod"
import type { PayoutAccountStatus } from "../../admin-storefront"

/**
 * Admin › Finance › Payout accounts (server/admin/payout-accounts-db.ts): every brand, with its
 * payout account (masked: bank, account name and the last 4 digits only, never the number) and
 * whether it can sell. Owner and Finance roles.
 */
export const PAYOUT_ACCOUNT_FILTERS = ["all", "missing", "pending", "verified"] as const
export type PayoutAccountFilter = (typeof PAYOUT_ACCOUNT_FILTERS)[number]

export const adminPayoutAccountsQuery = z.object({
  /** Brand name or handle (case-insensitive substring). */
  q: z.string().trim().max(120).optional(),
  status: z.enum(PAYOUT_ACCOUNT_FILTERS).default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type AdminPayoutAccountsQuery = z.infer<typeof adminPayoutAccountsQuery>

export type AdminPayoutAccountRowDto = {
  brandId: string
  handle: string
  name: string
  country: string
  reviewStatus: string
  closed: boolean
  founding: boolean
  claimStatus: string
  status: PayoutAccountStatus
  account: {
    bankName: string
    accountName: string
    /** The last 4 digits only. */
    last4: string
    currency: string
    country: string
    /** "paystack" when a provider confirmed it; "stub" otherwise (Yard pays it by hand). */
    provider: string
    /** When it was added or last changed (ISO). */
    changedAt: string
  } | null
  /** A storefront is published and live (not unpublished by Yard; a founding brand has launched). */
  storefrontLive: boolean
  canSell: boolean
  /** Why it can't sell, in the order the admin should fix them. */
  reasons: string[]
}

export type AdminPayoutAccountsDto = {
  items: AdminPayoutAccountRowDto[]
  total: number
  page: number
  pageSize: number
  /** Brands per status over the whole table (the filter chips' counts), ignoring the search. */
  counts: Record<PayoutAccountFilter, number>
}
