import { getWebsiteScan } from "@/server/catalog/from-website"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/**
 * GET /api/admin/founding-brands/from-website/{importId} (brands.founding + catalog.propose) →
 * { import, suggestion, duplicates, created }: the scan's progress and products, Yard's best
 * guesses for the brand card, brands that look like the same one, and once Create store ran, the
 * founding brand and its website watch. Polled while the scan or the import runs.
 */
export const GET = route({ auth: "admin", permission: "brands.founding", rate: { key: "admin.brand_imports.read", limit: 240, windowSec: 60 } }, async ({ actor, params }) => getWebsiteScan(actor, idParam(params, "id")))
