import { getStudioProposal } from "@/server/catalog/proposals"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/** GET /api/studio/proposals/{id} (any member) → { proposal }. Another brand's suggestion is 404. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.proposals", limit: 240, windowSec: 60 } }, async ({ actor, params }) => getStudioProposal(actor, idParam(params, "id")))
