import "server-only"
import { and, inArray, ne } from "drizzle-orm"
import { afterCommit, db } from "../db"
import { catalogProducts, catalogVariants } from "../db/schema/catalog"
import { refreshBrandMediaVisibility } from "../media/visibility"
import { invalidateMemo } from "../cache"
import { log } from "../log"

/**
 * After-commit side effects of catalog writes: drop the public read memo and, for product
 * changes, ask ENGAGEMENT's search to reindex (only if src/server/search exports reindexProduct).
 * Never inside the transaction (no I/O there, §1.3).
 */
type Change = {
  products?: string[]
  variants?: string[]
  /** Variants that went from none available to some (ENGAGEMENT's back-in-stock job reads stock itself). */
  restocked?: string[]
  /** Also reindex the products of `variants` (sales and restocks change a product's availability). */
  reindexVariants?: boolean
  /** Brands whose product/collection photos may have changed visibility (products' brands are added automatically). */
  brands?: string[]
  /**
   * Brands whose whole catalogue must be re-indexed: the brand row and every non-archived product.
   * For brand-level changes that flip what search stores for each product (a founding brand
   * launching, being claimed, getting its first payout account, a rename).
   */
  reindexBrands?: string[]
}

type SearchModule = { reindexProduct?: (productId: string) => Promise<unknown>; reindexBrand?: (brandId: string) => Promise<unknown> }

async function loadSearch(): Promise<SearchModule | null> {
  try {
    return (await import("../search")) as SearchModule
  } catch {
    return null
  }
}

export function catalogChanged(change: Change) {
  afterCommit(async () => {
    invalidateMemo("catalog:")
    // Uploaded product and collection photos are public only while a published product or
    // collection of a listed brand shows them (media/visibility.ts). One brand's media is small.
    const brandIds = new Set([...(change.brands ?? []), ...(change.reindexBrands ?? [])])
    if (change.products?.length) {
      const d = await db()
      const rows = await d.select({ brandId: catalogProducts.brandId }).from(catalogProducts).where(inArray(catalogProducts.id, change.products))
      for (const r of rows) brandIds.add(r.brandId)
    }
    for (const b of brandIds) await refreshBrandMediaVisibility(b).catch((e: unknown) => log.error(`[yard] catalog: media visibility for ${b} failed`, e))
    const ids = new Set(change.products ?? [])
    if (change.reindexVariants && change.variants?.length) {
      const d = await db()
      const rows = await d.select({ productId: catalogVariants.productId }).from(catalogVariants).where(inArray(catalogVariants.id, change.variants))
      for (const r of rows) ids.add(r.productId)
    }
    if (change.reindexBrands?.length) {
      const d = await db()
      const rows = await d
        .select({ id: catalogProducts.id })
        .from(catalogProducts)
        .where(and(inArray(catalogProducts.brandId, change.reindexBrands), ne(catalogProducts.status, "archived")))
      for (const r of rows) ids.add(r.id)
    }
    if (!ids.size && !change.reindexBrands?.length) return
    const search = await loadSearch()
    for (const b of change.reindexBrands ?? []) {
      if (typeof search?.reindexBrand === "function") await search.reindexBrand(b).catch((e: unknown) => log.error(`[yard] catalog: reindexBrand(${b}) failed`, e))
    }
    if (typeof search?.reindexProduct !== "function") return
    for (const id of ids) {
      await search.reindexProduct(id).catch((e: unknown) => log.error(`[yard] catalog: reindexProduct(${id}) failed`, e))
    }
  })
}
