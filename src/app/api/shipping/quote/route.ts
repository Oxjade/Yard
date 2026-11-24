import { quoteBody } from "@/lib/api/contracts/shipping"
import { requireShopper } from "@/server/auth/dal"
import { route } from "@/server/http/route"
import { quoteGroups } from "@/server/shipping/quote"

/**
 * POST /api/shipping/quote (public, §6.5): per-brand options, estimates and a quoteToken (HMAC
 * under keys.quote over brand, destination, lines, subtotal and the option prices; 30 minutes).
 * The brand of each group is derived from its lines; a brandId that disagrees is refused.
 *
 * With `address` (checkout) and a signed-in shopper, brands that ship with a live courier get the
 * courier's prices (docs/SHIPPING.md). Without a session the address is ignored, so the courier
 * aggregator is never asked on behalf of anonymous traffic.
 */
export const POST = route(
  { auth: "public", body: quoteBody, rate: { key: "shipping.quote", limit: 60, windowSec: 60, anonGlobal: 3000 } },
  async ({ body }) => {
    const shopper = body.address ? await requireShopper().catch(() => null) : null
    return quoteGroups({ ...body, address: shopper && body.address ? { ...body.address, email: shopper.email } : null })
  },
)
