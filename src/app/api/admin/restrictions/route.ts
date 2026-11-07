import { restrictionsQuery } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { listRestrictions } from "@/server/moderation"

/** GET /api/admin/restrictions[?subject=]: one account's or brand's restrictions, or every open one. */
export const GET = route({ auth: "admin", permission: "abuse.view", query: restrictionsQuery }, async ({ query }) => listRestrictions(query.subject))
