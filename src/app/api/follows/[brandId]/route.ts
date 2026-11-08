import { isSafeId } from "@/lib/api/contracts/common"
import { unfollowBrand } from "@/server/follows"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** DELETE /api/follows/{brandId}: unfollow. */
export const DELETE = route({ auth: "shopper", rate: { key: "follows.toggle", limit: 60, windowSec: 60, daily: 1000 } }, async ({ actor, params, ipHash, req }) => {
  if (!isSafeId(params.brandId)) throw notFound("We couldn't find that brand.")
  return unfollowBrand(actor, params.brandId, { ipHash, userAgent: req.headers.get("user-agent") })
})
