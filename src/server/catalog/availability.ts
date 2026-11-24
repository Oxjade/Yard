import { sql, type SQL } from "drizzle-orm"
import { catalogProducts, catalogVariants } from "../db/schema/catalog"

/**
 * What "available" means for a variant, in one place (no server-only: the tests run it on a real
 * database). A variant either counts its stock (track_stock, the default: on_hand - held) or is
 * "available, stock not tracked" (an imported shop that says in stock without a count, or a brand
 * that marked it so in Studio): always available, shown as in stock, never "only 2 left".
 */

/** What an untracked variant reports as available: above every per-line cap and every low-stock line. */
export const UNTRACKED_AVAILABLE = 99

export type StockCounters = { trackStock: boolean; onHand: number; held: number }

export function availableOf(v: StockCounters): number {
  return v.trackStock ? Math.max(0, v.onHand - v.held) : UNTRACKED_AVAILABLE
}

/** SQL: this variant can be bought (ignores status and the brand: callers add those). */
export function variantInStockSql(): SQL<boolean> {
  return sql<boolean>`(not ${catalogVariants.trackStock} or ${catalogVariants.onHand} > ${catalogVariants.held})`
}

/** SQL: available units of this variant, as availableOf. */
export function variantAvailableSql(): SQL<number> {
  return sql<number>`(case when ${catalogVariants.trackStock} then greatest(${catalogVariants.onHand} - ${catalogVariants.held}, 0) else ${UNTRACKED_AVAILABLE} end)`
}

/** SQL: the product (catalog_products in the outer query) has an active variant that can be bought. */
export function productInStockSql(): SQL<boolean> {
  return sql<boolean>`exists (select 1 from catalog_variants iv where iv.product_id = ${catalogProducts.id} and iv.status = 'active' and (not iv.track_stock or iv.on_hand > iv.held))`
}

/**
 * The first ORDER BY key of every public listing: pieces a shopper can buy now first, sold-out
 * (or not yet selling) last. `forSale` is the brand's selling predicate (brandForSaleSql), so an
 * unclaimed founding brand's pieces, which can't be bought yet, sort with the sold out.
 */
export function inStockFirstOrder(forSale: SQL): SQL {
  return sql`(${forSale} and ${productInStockSql()}) desc`
}
