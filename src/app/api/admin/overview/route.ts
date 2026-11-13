import { route } from "@/server/http/route"
import { overviewStats } from "@/server/admin/overview-stats"

/** GET /api/admin/overview: the Control Center's real figures (accounts, brands, products, orders, sales, 30-day series). */
export const GET = route({ rate: { key: "admin.overview", limit: 120, windowSec: 60 }, auth: "admin", permission: "abuse.view" }, async () => overviewStats())
