import { isSafeId } from "@/lib/api/contracts/common"
import { backInStockStatus, cancelBackInStock } from "@/server/follows"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** GET /api/wishlist/back-in-stock/{variantId}: `{ variantId, watching }`, whether a back-in-stock alert is pending (saved product or not). */
export const GET = route({ auth: "shopper", rate: { key: "wishlist.bis.read", limit: 120, windowSec: 60 } }, async ({ actor, params }) => {
  if (!isSafeId(params.variantId)) throw notFound("We couldn't find that watch.")
  return backInStockStatus(actor.userId, params.variantId)
})

/** DELETE /api/wishlist/back-in-stock/{variantId}: stop watching. */
export const DELETE = route({ auth: "shopper", rate: { key: "wishlist.bis", limit: 30, windowSec: 60 } }, async ({ actor, params }) => {
  if (!isSafeId(params.variantId)) throw notFound("We couldn't find that watch.")
  return cancelBackInStock(actor.userId, params.variantId)
})
