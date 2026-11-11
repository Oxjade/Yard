import { route } from "@/server/http/route"
import { studioOverview, studioOverviewQuery } from "@/server/orders/overview"

/** GET /api/studio/overview?days=7|30|90 (any member): the active brand's sales, orders to ship, recent orders and top products, from the database. */
export const GET = route(
  { auth: "brand", permission: "any_member", query: studioOverviewQuery, rate: { key: "studio.overview", limit: 60, windowSec: 60 } },
  async ({ actor, query }) => studioOverview(actor.brandId, actor.brand.currency, query.days as 7 | 30 | 90),
)
