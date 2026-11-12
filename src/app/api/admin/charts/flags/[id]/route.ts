import { route } from "@/server/http/route"
import { flagDetail } from "@/server/moderation"

/** GET /api/admin/charts/flags/{id}: the flag with its evidence (counts and ratios) and ranking components. */
export const GET = route({ rate: { key: "admin.charts.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "charts.review" }, async ({ params }) => flagDetail(params.id))
