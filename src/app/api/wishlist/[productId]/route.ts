import { isSafeId } from "@/lib/api/contracts/common"
import { removeFromWishlist } from "@/server/follows"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** DELETE /api/wishlist/{productId}. */
export const DELETE = route({ auth: "shopper", rate: { key: "wishlist.toggle", limit: 60, windowSec: 60, daily: 2000 } }, async ({ actor, params, ipHash, req }) => {
  if (!isSafeId(params.productId)) throw notFound("We couldn't find that piece.")
  return removeFromWishlist(actor, params.productId, { ipHash, userAgent: req.headers.get("user-agent") })
})
