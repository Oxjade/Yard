/**
 * The one sell rule, in TypeScript (no React, no server imports). Its SQL twin is
 * src/server/catalog/for-sale-sql.ts brandForSaleSql, which every checkout, cart, PDP and search
 * read uses; src/server/admin/payout-accounts.test.ts checks the two agree on every case.
 *
 * A payout account is never needed to sell. Ordinary brands (claim_status 'none') and claimed
 * founding brands sell without one: Yard holds their earnings and emails them to add one
 * (ledger/payout-needed-db.ts). The one exception is an unclaimed founding brand, which never sells.
 */

export type NotForSaleReason = "unclaimed"

/** Why a brand can't take orders under the sell rule, or null when it can. A payout account plays no part. */
export function notForSaleOf(claimStatus: string): NotForSaleReason | null {
  return claimStatus === "unclaimed" ? "unclaimed" : null
}
