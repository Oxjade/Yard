import { importListQuery, importedStockBody } from "@/lib/api/contracts/imports"
import { markImportedStockAvailable, previewImportedStock } from "@/server/catalog/importer/imported-stock"
import { route } from "@/server/http/route"

/**
 * GET /api/admin/brand-imports/stock?brandId= (catalog.propose; + brands.founding for an unclaimed
 * founding brand) → ImportedStockDto: what "Mark imported products as available (stock not
 * tracked)" would change for the brand's products imported from its website, and what it leaves.
 */
export const GET = route({ auth: "admin", permission: "catalog.propose", query: importListQuery, rate: { key: "admin.imported_stock.read", limit: 120, windowSec: 60 } }, async ({ actor, query }) => previewImportedStock(actor, query.brandId))

/**
 * POST /api/admin/brand-imports/stock { brandId } → ImportedStockDto with what changed: imported
 * sizes the site showed as available without a count become "available, stock not tracked".
 * Audited catalog.imported_stock_untracked; nothing the brand counted or sold is touched.
 */
export const POST = route({ auth: "admin", permission: "catalog.propose", body: importedStockBody, rate: { key: "admin.imported_stock.apply", limit: 20, windowSec: 3600 } }, async ({ actor, body, ipHash }) => markImportedStockAvailable(actor, body.brandId, ipHash))
