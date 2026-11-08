import { route } from "@/server/http/route"
import { viewHeldNote } from "@/server/moderation/delivery"
import { kitRequest } from "@/server/moderation/shared"

/**
 * POST /api/admin/delivery/notes/{id}/view: the text of a brand note D's screen held (a shipment
 * update's note by its event id, or a complaint reply by its complaint id), audited as
 * delivery_note.viewed. Only Support, Trust & safety and owners open it (shipping.resolve or
 * messages.view_reports); list responses carry only the held mark. A POST, so no link can trigger it.
 */
export const POST = route(
  { auth: "admin", permission: "shipping.view", rate: { key: "admin.evidence", limit: 60, windowSec: 60 } },
  async ({ req, actor, params, ipHash }) => viewHeldNote({ actor, ipHash, kit: kitRequest(req) }, params.id),
)
