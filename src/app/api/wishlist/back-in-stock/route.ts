import { backInStockBody } from "@/server/follows/contracts"
import { requestBackInStock } from "@/server/follows"
import { json, route } from "@/server/http/route"

/** POST /api/wishlist/back-in-stock { variantId }: tell me when this sold-out size/colour is back (once; in-app and email per preferences). */
export const POST = route({ auth: "shopper", body: backInStockBody, maxBody: 1024, rate: { key: "wishlist.bis", limit: 30, windowSec: 60, daily: 300 } }, async ({ actor, body }) =>
  json(await requestBackInStock(actor.userId, body.variantId), 201),
)
