import { route } from "@/server/http/route"
import { analyticsDaysQuery, studioAnalytics } from "@/server/analytics"

/** GET /api/studio/analytics?days=7|30|90 (any member): the active brand's sales, traffic, conversion, products and drops, memoised two minutes. */
export const GET = route(
  { auth: "brand", permission: "any_member", query: analyticsDaysQuery, rate: { key: "studio.analytics", limit: 60, windowSec: 60 } },
  async ({ actor, query }) => studioAnalytics(actor.brandId, actor.brand.currency, query.days as 7 | 30 | 90),
)
