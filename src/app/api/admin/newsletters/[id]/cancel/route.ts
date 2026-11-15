import { idParam } from "@/server/catalog/params"
import { cancelCampaign } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** POST /api/admin/newsletters/{id}/cancel (comms.newsletter) → { campaign }: a scheduled campaign back to draft, or a sending one stopped. Audited. */
export const POST = route({ auth: "admin", permission: "comms.newsletter", rate: { key: "admin.newsletters.cancel", limit: 30, windowSec: 60 } }, async ({ actor, params, ipHash }) => cancelCampaign(actor, idParam(params, "id"), ipHash))
