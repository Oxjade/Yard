import { sql } from "drizzle-orm"
import { brands } from "../db/schema/brands"

/**
 * The one not-for-sale predicate (founding brands). An unclaimed brand never sells; a claimed one
 * sells once it has a payout account; every ordinary brand (claim_status 'none') sells, with or
 * without one. Used by getSellableVariants (cart pricing, PDP availability, watches, search) and
 * isSellable (the stock hold inside checkout), so no path can sell around it. Its TypeScript twin,
 * for labels and copy, is src/lib/sell-rule.ts notForSaleOf. No server-only, so the tests can run it.
 */
export function brandForSaleSql() {
  return sql`(${brands.claimStatus} <> 'unclaimed' and (${brands.claimStatus} <> 'claimed' or exists (select 1 from brand_payout_accounts bpa where bpa.brand_id = ${brands.id})))`
}
