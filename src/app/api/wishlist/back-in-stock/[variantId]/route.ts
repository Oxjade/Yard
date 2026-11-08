import { isSafeId } from "@/lib/api/contracts/common"
import { cancelBackInStock } from "@/server/follows"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** DELETE /api/wishlist/back-in-stock/{variantId}: stop watching. */
export const DELETE = route({ auth: "shopper", rate: { key: "wishlist.bis", limit: 30, windowSec: 60 } }, async ({ actor, params }) => {
  if (!isSafeId(params.variantId)) throw notFound("We couldn't find that watch.")
  return cancelBackInStock(actor.userId, params.variantId)
})
