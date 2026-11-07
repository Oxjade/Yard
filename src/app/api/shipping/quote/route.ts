import { quoteBody } from "@/lib/api/contracts/shipping"
import { route } from "@/server/http/route"
import { quoteGroups } from "@/server/shipping/quote"

/**
 * POST /api/shipping/quote (public, §6.5): per-brand options, estimates and a quoteToken (HMAC
 * under keys.quote over brand, destination, lines, subtotal and the option prices; 30 minutes).
 * The brand of each group is derived from its lines; a brandId that disagrees is refused.
 */
export const POST = route(
  { auth: "public", body: quoteBody, rate: { key: "shipping.quote", limit: 60, windowSec: 60, anonGlobal: 3000 } },
  async ({ body }) => quoteGroups(body),
)
