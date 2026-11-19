import { websiteScanBody } from "@/lib/api/contracts/from-website"
import { startWebsiteScan } from "@/server/catalog/from-website"
import { json, route } from "@/server/http/route"

/**
 * POST /api/admin/founding-brands/from-website { url, consent: true } (owner: brands.founding, plus
 * catalog.propose) → 201 { import, suggestion, duplicates, created }: starts the importer's scan of
 * a brand's website before the brand exists (Create brand from website, docs/IMPORTER.md). The
 * consent and the admin are recorded; audited catalog.import_scan_started. 20 an hour per admin,
 * 10 an hour per site.
 */
export const POST = route(
  { auth: "admin", permission: "brands.founding", body: websiteScanBody, rate: { key: "admin.brand_imports.scan", limit: 20, windowSec: 3600, daily: 100 } },
  async ({ actor, body, ipHash }) => json(await startWebsiteScan(actor, body, ipHash), 201),
)
