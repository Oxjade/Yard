import { studioDashboardQuery } from "@/lib/api/contracts/studio-app"
import { route } from "@/server/http/route"
import { studioDashboard } from "@/server/studio-app"

/** GET /api/studio/dashboard?days=7|30 (any member): the app's Studio home in one call (docs/APP.md › Studio in the app). */
export const GET = route(
  { auth: "brand", permission: "any_member", query: studioDashboardQuery, rate: { key: "studio.dashboard", limit: 60, windowSec: 60 } },
  async ({ actor, query }) => studioDashboard(actor, query.days as 7 | 30),
)
