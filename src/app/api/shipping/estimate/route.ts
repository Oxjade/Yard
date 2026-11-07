import { estimateQuery } from "@/lib/api/contracts/shipping"
import { route } from "@/server/http/route"
import { productEstimate } from "@/server/shipping/quote"

/**
 * GET /api/shipping/estimate?product&to&city&qty&cur&release (public, §6.5; milestone 1). The
 * options a piece ships with to a destination, each with an estimated dispatch and arrival range
 * from the engine. Never guaranteed: every estimate says so.
 */
export const GET = route(
  { auth: "public", query: estimateQuery, rate: { key: "shipping.estimate", limit: 120, windowSec: 60, anonGlobal: 6000 } },
  async ({ query }) => productEstimate(query),
)
