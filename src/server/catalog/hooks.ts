import "server-only"
import { inArray } from "drizzle-orm"
import { afterCommit, db } from "../db"
import { catalogVariants } from "../db/schema/catalog"
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
}

type SearchModule = { reindexProduct?: (productId: string) => Promise<unknown> }

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
    const ids = new Set(change.products ?? [])
    if (change.reindexVariants && change.variants?.length) {
      const d = await db()
      const rows = await d.select({ productId: catalogVariants.productId }).from(catalogVariants).where(inArray(catalogVariants.id, change.variants))
      for (const r of rows) ids.add(r.productId)
    }
    if (!ids.size) return
    const search = await loadSearch()
    if (typeof search?.reindexProduct !== "function") return
    for (const id of ids) {
      await search.reindexProduct(id).catch((e: unknown) => log.error(`[yard] catalog: reindexProduct(${id}) failed`, e))
    }
  })
}
