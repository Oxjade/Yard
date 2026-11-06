import { chartFlagsQuery } from "@/lib/api/contracts/admin"
import { route } from "@/server/http/route"
import { listFlags } from "@/server/moderation"

/** GET /api/admin/charts/flags?status=open|decided|frozen|all, with every Charts freeze. */
export const GET = route({ auth: "admin", permission: "charts.review", query: chartFlagsQuery }, async ({ query }) => listFlags(query.status))
