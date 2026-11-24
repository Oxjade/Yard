/**
 * The one sell rule, in TypeScript (no React, no server imports). Its SQL twin is
 * src/server/catalog/for-sale-sql.ts brandForSaleSql, which every checkout, cart, PDP and search
 * read uses; src/server/admin/payout-accounts.test.ts checks the two agree on every case.
 *
 * Ordinary brands (claim_status 'none') sell without a payout account: Yard holds their earnings
 * and emails them to add one (ledger/payout-needed-db.ts). Founding brands are the exception: an
 * unclaimed one never sells, and a claimed one sells once it has a payout account.
 */

export type NotForSaleReason = "unclaimed" | "no_payout_account"

/** Why a brand can't take orders under the sell rule, or null when it can. */
export function notForSaleOf(claimStatus: string, hasPayoutAccount: boolean): NotForSaleReason | null {
  if (claimStatus === "unclaimed") return "unclaimed"
  if (claimStatus === "claimed" && !hasPayoutAccount) return "no_payout_account"
  return null
}

/** Whether Buy stays off until the brand saves a payout account (a founding brand: claimed, or not yet). */
export const payoutAccountNeededToSell = (claimStatus: string): boolean => claimStatus === "claimed" || claimStatus === "unclaimed"
