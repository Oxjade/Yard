import { chartQuery } from "@/lib/api/contracts/charts"
import { getBoard } from "@/server/charts"
import { route } from "@/server/http/route"

/**
 * GET /api/charts?chart&period&category&country&city (§6.3): the live board, public. `entries`
 * never carry `score` or `components`; sponsored placements come back separately; `sample: true`
 * while the labelled sample baseline is part of the ranking.
 */
export const GET = route(
  { auth: "public", query: chartQuery, cache: { public: 30, swr: 60 }, rate: { key: "charts.read", limit: 120, windowSec: 60, anonGlobal: 6000 } },
  async ({ query }) => getBoard(query),
)
