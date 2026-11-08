import { followBody } from "@/server/follows/contracts"
import { followBrand, listFollows } from "@/server/follows"
import { route } from "@/server/http/route"

/** GET /api/follows: the brands the shopper follows, newest first, with follower counts. */
export const GET = route({ auth: "shopper", rate: { key: "follows.list", limit: 120, windowSec: 60 } }, async ({ actor }) => ({ items: await listFollows(actor.userId) }))

/** POST /api/follows { brandId }: follow a brand (records the follow signal, so charts count it once). */
export const POST = route({ auth: "shopper", body: followBody, maxBody: 1024, rate: { key: "follows.toggle", limit: 60, windowSec: 60, daily: 1000 } }, async ({ actor, body, ipHash, req }) =>
  followBrand(actor, body.brandId, { ipHash, userAgent: req.headers.get("user-agent") }),
)
