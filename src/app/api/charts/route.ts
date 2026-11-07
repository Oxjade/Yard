import { chartQuery } from "@/lib/api/contracts/charts"
import { getBoard } from "@/server/charts"
import { READ_RATE } from "@/server/charts/limit"
import { rateLimited } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { hit } from "@/server/security/rate-limit"
import { currentAnon } from "@/server/signals/anon"

/**
 * GET /api/charts?chart&period&category&country&city (§6.3): the live board, public. `entries`
 * never carry `score` or `components`; sponsored placements come back separately; `sample: true`
 * while the labelled sample baseline is part of the ranking. Only real categories, gazetteer
 * cities and market countries are accepted (400 otherwise). Rate: 120 a minute per caller (the
 * client IP behind a trusted proxy, else this browser's signed anonymous id, the same bucket the
 * /charts page draws on) and 6,000 a minute for all anonymous callers.
 */
export const GET = route({ auth: "public", query: chartQuery, cache: { public: 30, swr: 60 }, rate: READ_RATE }, async ({ query, ipHash }) => {
  if (!ipHash) {
    const anon = await currentAnon()
    if (anon) {
      const r = hit(`${READ_RATE.key}:anon:${anon.actorId}`, READ_RATE.limit, READ_RATE.windowSec)
      if (!r.ok) throw rateLimited(r.retryAfter)
    }
  }
  return getBoard(query)
})
