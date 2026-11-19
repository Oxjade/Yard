import { idParam } from "@/server/catalog/params"
import { getImport } from "@/server/catalog/importer/service"
import { route } from "@/server/http/route"

/** GET /api/admin/brand-imports/{id} (catalog.propose; + brands.founding for an unclaimed founding brand) → { import }: progress, found products, per-item results. Polled while it runs. */
export const GET = route({ auth: "admin", permission: "catalog.propose", rate: { key: "admin.brand_imports.read", limit: 240, windowSec: 60 } }, async ({ actor, params }) => getImport(actor, idParam(params, "id")))
