import { getScopes } from "@/server/charts"
import { READ_RATE } from "@/server/charts/limit"
import { route } from "@/server/http/route"

/** GET /api/charts/scopes: cities, countries and categories with their eligible cohorts (§6.3). */
export const GET = route({ auth: "public", cache: { public: 300 }, rate: READ_RATE }, async () => getScopes())
