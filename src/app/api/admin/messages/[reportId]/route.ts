import { route } from "@/server/http/route"
import { messageCase } from "@/server/moderation"

/** GET /api/admin/messages/{id}: one case (a report, a held message or a spam signal), metadata only (subjectGone when the reported conversation was deleted). */
export const GET = route({ rate: { key: "admin.messages", limit: 120, windowSec: 60 }, auth: "admin", permission: "messages.view_reports" }, async ({ params }) => messageCase(params.reportId))
