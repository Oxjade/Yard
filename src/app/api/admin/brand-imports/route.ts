import { importListQuery, importScanBody } from "@/lib/api/contracts/imports"
import { listImports, startScan } from "@/server/catalog/importer/service"
import { json, route } from "@/server/http/route"

/**
 * GET /api/admin/brand-imports?brandId= (catalog.propose; an unclaimed founding brand also needs
 * brands.founding) → { brand, imports }: the brand as the importer sees it and its last 20 imports.
 */
export const GET = route({ auth: "admin", permission: "catalog.propose", query: importListQuery, rate: { key: "admin.brand_imports.read", limit: 240, windowSec: 60 } }, async ({ actor, query }) => listImports(actor, query.brandId))

/**
 * POST /api/admin/brand-imports { brandId, url, consent: true } (catalog.propose, + brands.founding
 * for an unclaimed founding brand) → 201 { import }: starts a background scan of the brand's
 * website (docs/IMPORTER.md). 10 scans an hour per brand; one running import per brand (409).
 * Audited catalog.import_scan_started with the consent.
 */
export const POST = route(
  { auth: "admin", permission: "catalog.propose", body: importScanBody, rate: { key: "admin.brand_imports.scan", limit: 20, windowSec: 3600, daily: 100 } },
  async ({ actor, body, ipHash }) => json(await startScan(actor, body, ipHash), 201),
)
