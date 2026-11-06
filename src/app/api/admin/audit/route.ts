import { auditQuery } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { listAudit } from "@/server/moderation"

/** GET /api/admin/audit?subjectType=&subjectId=a,b&actorKind=&cursor=: server audit rows, newest first. */
export const GET = route({ auth: "admin", permission: "audit.view", query: auditQuery }, async ({ query }) => listAudit(query))
