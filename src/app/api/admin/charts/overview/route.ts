import { route } from "@/server/http/route"
import { chartsOverview } from "@/server/moderation"

/** GET /api/admin/charts/overview: board health, excluded-signal share and the honest signal notes. */
export const GET = route({ rate: { key: "admin.charts.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "charts.review" }, async () => chartsOverview())
