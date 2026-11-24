/**
 * Pieces a shopper can buy first, sold out last, each group keeping the order it came in (a stable
 * partition, so a brand's own order or an explicit price sort still holds within each group). The
 * server listings sort this way in SQL (src/server/catalog/availability.ts); this is for lists put
 * together in the browser or by id (a collection's saved order).
 */
export function inStockFirst<T>(list: readonly T[], inStock: (item: T) => boolean): T[] {
  const yes: T[] = []
  const no: T[] = []
  for (const item of list) (inStock(item) ? yes : no).push(item)
  return [...yes, ...no]
}

/** A storefront Product (src/lib/data/types) is in stock when a variant has stock left and its brand sells. */
export function productInStock(p: { variants: { stock: number; reserved: number }[]; brandSummary?: { forSale?: boolean } }): boolean {
  if (p.brandSummary?.forSale === false) return false
  return p.variants.some((v) => v.stock - v.reserved > 0)
}
