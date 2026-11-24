import { route } from "@/server/http/route"
import { bulkStockBody } from "@/server/catalog/contracts"
import { bulkSetStock, markUntracked } from "@/server/catalog/stock"

/**
 * POST /api/studio/catalog/products/stock (orders.fulfil, like a single stock change): Studio ›
 * Products bulk stock for the selected products. { mode: "untracked", productIds } marks every
 * size "available, stock not tracked"; { mode: "set", productIds, qty } gives every size the count
 * `qty`. → { products, variants, keptForHolds? }. Audited; sizes that come back notify back-in-stock.
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: bulkStockBody, rate: { key: "studio.catalog.stock_bulk", limit: 30, windowSec: 60 } },
  async ({ actor, body, ipHash }) => (body.mode === "untracked" ? markUntracked(actor, body.productIds, ipHash) : bulkSetStock(actor, body.productIds, body.qty, ipHash)),
)
