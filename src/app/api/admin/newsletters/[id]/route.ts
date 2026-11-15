import { newsletterPatchBody } from "@/lib/api/contracts/newsletter"
import { idParam } from "@/server/catalog/params"
import { deleteCampaign, getCampaign, updateCampaign } from "@/server/newsletter"
import { route } from "@/server/http/route"

/** GET /api/admin/newsletters/{id} (comms.newsletter) → { campaign }: content, status, counts and what still stops it from sending. */
export const GET = route({ auth: "admin", permission: "comms.newsletter", rate: { key: "admin.newsletters", limit: 240, windowSec: 60 } }, async ({ params }) => getCampaign(idParam(params, "id")))

/** PATCH /api/admin/newsletters/{id} { revision, …fields } (comms.newsletter): the composer's autosave. Drafts only; a stale revision is 409. */
export const PATCH = route(
  { auth: "admin", permission: "comms.newsletter", body: newsletterPatchBody, maxBody: 32 * 1024, rate: { key: "admin.newsletters.save", limit: 240, windowSec: 60 } },
  async ({ actor, params, body }) => updateCampaign(actor, idParam(params, "id"), body),
)

/** DELETE /api/admin/newsletters/{id} (comms.newsletter): deletes a draft. Audited. */
export const DELETE = route({ auth: "admin", permission: "comms.newsletter", rate: { key: "admin.newsletters.delete", limit: 30, windowSec: 60 } }, async ({ actor, params }) => deleteCampaign(actor, idParam(params, "id")))
