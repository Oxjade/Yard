import { mergeAnonCart } from "@/server/cart"
import { route } from "@/server/http/route"

/**
 * POST /api/cart/merge (shopper): merges this browser's anonymous cart into the shopper's. Every
 * cart route also merges lazily; call this right after sign-in to show the merged count.
 */
export const POST = route({ auth: "shopper", rate: { key: "cart.merge", limit: 20, windowSec: 60 } }, async ({ actor }) => mergeAnonCart(actor.userId))
