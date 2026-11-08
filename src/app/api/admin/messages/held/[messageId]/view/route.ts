import { route } from "@/server/http/route"
import { viewHeld } from "@/server/moderation"
import { kitRequest } from "@/server/moderation/shared"

/** POST /api/admin/messages/held/{messageId}/view: the held message itself, audited as message_held.viewed. */
export const POST = route({ auth: "admin", permission: "messages.view_reports", rate: { key: "admin.evidence", limit: 60, windowSec: 60 } }, async ({ req, actor, params, ipHash }) => viewHeld({ actor, ipHash, kit: kitRequest(req) }, params.messageId))
