import { followCountsQuery } from "@/server/follows/contracts"
import { followerCounts } from "@/server/follows"
import { route } from "@/server/http/route"

/** GET /api/follows/counts?brandIds=a&brandIds=b: public follower counts (baseline + real follows). */
export const GET = route({ auth: "public", query: followCountsQuery, rate: { key: "follows.counts", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 60, swr: 300 } }, async ({ query }) => ({
  counts: await followerCounts(query.brandIds),
}))
