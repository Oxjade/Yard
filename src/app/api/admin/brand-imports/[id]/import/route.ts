import { importRunBody } from "@/lib/api/contracts/imports"
import { idParam } from "@/server/catalog/params"
import { startImport } from "@/server/catalog/importer/service"
import { json, route } from "@/server/http/route"

/**
 * POST /api/admin/brand-imports/{id}/import { products: [...ticked and edited], profile?, note? }
 * (catalog.propose; + brands.founding for an unclaimed founding brand) → 202 { import }. Queues the
 * ticked products; the runner copies their photos into Yard and sends each as a Suggestion from
 * Yard. Products created before are never created again; a duplicate is skipped unless
 * allowDuplicate. Audited catalog.import_started.
 */
export const POST = route(
  { auth: "admin", permission: "catalog.propose", body: importRunBody, maxBody: 512 * 1024, rate: { key: "admin.brand_imports.run", limit: 30, windowSec: 3600, daily: 200 } },
  async ({ actor, params, body, ipHash }) => json(await startImport(actor, idParam(params, "id"), body, ipHash), 202),
)
