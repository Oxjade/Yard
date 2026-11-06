import { messagesQuery } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { listMessages } from "@/server/moderation"

/** GET /api/admin/messages?tab=reported|held|spam|closed: metadata only, never a message body (§8.1). */
export const GET = route({ auth: "admin", permission: "messages.view_reports", query: messagesQuery }, async ({ query }) => listMessages(query.tab))
