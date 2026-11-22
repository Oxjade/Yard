import { previewBrandRemoval } from "@/server/catalog/brand-removal"
import { route } from "@/server/http/route"

/**
 * GET /api/admin/brands/{id}/removal (brands.delete, owner admins) → what Delete brand would do:
 * `mode` "delete" (erased: no orders, payouts or money on record) or "close" (kept for its orders
 * and money trail), `why` in one sentence, the financial `records` that decide it and the brand's
 * `footprint` (products, files, members…). Reads only.
 */
export const GET = route({ auth: "admin", permission: "brands.delete", rate: { key: "admin.brands.removal.read", limit: 60, windowSec: 60 } }, async ({ actor, params }) => previewBrandRemoval(actor, params.id))
