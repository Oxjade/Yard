import { getScopes } from "@/server/charts"
import { route } from "@/server/http/route"

/** GET /api/charts/scopes: cities, countries and categories with their eligible cohorts (§6.3). */
export const GET = route({ auth: "public", cache: { public: 300 }, rate: { key: "charts.read", limit: 120, windowSec: 60, anonGlobal: 6000 } }, async () => getScopes())
