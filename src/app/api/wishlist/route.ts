import { wishlistBody } from "@/server/follows/contracts"
import { addToWishlist, listWishlist } from "@/server/follows"
import { route } from "@/server/http/route"

/** GET /api/wishlist: saved pieces with current price and stock (live from the catalogue when available) and back-in-stock watches. */
export const GET = route({ auth: "shopper", rate: { key: "wishlist.list", limit: 120, windowSec: 60 } }, async ({ actor }) => ({ items: await listWishlist(actor.userId) }))

/** POST /api/wishlist { productId }: save a piece (records the wishlist_add signal for sample-catalogue pieces). */
export const POST = route({ auth: "shopper", body: wishlistBody, maxBody: 1024, rate: { key: "wishlist.toggle", limit: 60, windowSec: 60, daily: 2000 } }, async ({ actor, body, ipHash, req }) =>
  addToWishlist(actor, body.productId, { ipHash, userAgent: req.headers.get("user-agent") }),
)
