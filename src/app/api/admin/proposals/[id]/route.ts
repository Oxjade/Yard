import { getAdminProposal } from "@/server/catalog/proposals"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/** GET /api/admin/proposals/{id} (catalog.propose) → { proposal }: the proposed product, before → after per field, and fields the brand changed since. */
export const GET = route({ auth: "admin", permission: "catalog.propose", rate: { key: "admin.proposals", limit: 240, windowSec: 60 } }, async ({ params }) => getAdminProposal(idParam(params, "id")))
