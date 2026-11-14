import { withdrawProposal } from "@/server/catalog/proposals"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/** POST /api/admin/proposals/{id}/withdraw (catalog.propose): withdraws a waiting suggestion (409 once answered). The brand's notification goes. Audited. */
export const POST = route({ auth: "admin", permission: "catalog.propose", rate: { key: "admin.proposals.write", limit: 60, windowSec: 60 } }, async ({ actor, params, ipHash }) => withdrawProposal(actor, idParam(params, "id"), ipHash))
