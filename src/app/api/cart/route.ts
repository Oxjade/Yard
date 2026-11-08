import { z } from "zod"
import { clearCart, resolveOwner, viewCart } from "@/server/cart"
import { noContent, route } from "@/server/http/route"

const cartQuery = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, { error: "Use a three-letter currency code." }).default("USD"),
  to: z.string().regex(/^[A-Z]{2}$/, { error: "Use a two-letter country code." }).optional(),
  city: z.string().trim().max(60).regex(/^[^\u0000-\u001F\u007F]*$/, { error: "Remove the hidden characters." }).optional(),
})

/**
 * GET /api/cart?currency=NGN&to=NG&city=Lagos (public: the signed-in shopper's cart, else this
 * browser's anonymous cart). Re-priced from CATALOG on every read; with `to` each brand group
 * carries its delivery options from the shipping engine. Signed in, an anonymous cart in this
 * browser is merged first.
 */
export const GET = route(
  { auth: "public", query: cartQuery, rate: { key: "cart.read", limit: 120, windowSec: 60, anonGlobal: 6000 } },
  async ({ query }) => viewCart(await resolveOwner({ create: false }), query),
)

/** DELETE /api/cart: empties the cart. */
export const DELETE = route({ auth: "public", rate: { key: "cart.write", limit: 60, windowSec: 60, anonGlobal: 3000 } }, async () => {
  const owner = await resolveOwner({ create: false })
  if (owner) await clearCart(owner)
  return noContent()
})
