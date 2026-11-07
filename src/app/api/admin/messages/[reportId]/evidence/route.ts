import { route } from "@/server/http/route"
import { viewEvidence } from "@/server/moderation"

/**
 * POST /api/admin/messages/{reportId}/evidence: the report's frozen snapshot, written to the audit
 * log as message_context.viewed. A POST, so no link or image can trigger it (§2.5); GET is 405.
 */
export const POST = route({ auth: "admin", permission: "messages.view_reports", rate: { key: "admin.evidence", limit: 60, windowSec: 60 } }, async ({ actor, params, ipHash }) => viewEvidence({ actor, ipHash }, params.reportId))
