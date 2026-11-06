import { registerOrderBody } from "@/lib/api/contracts/shipping"
import { json, route } from "@/server/http/route"
import { registerOrders } from "@/server/shipping/orders"

/**
 * POST /api/orders/register (shopper, §6.5). The body carries no ids, references, brand ids or
 * customer ids (strict: any such field is 400). The server derives each brand from its lines,
 * verifies and re-checks every quote (409 on a change), and mints the group, order ids and
 * references. Idempotent per (shopper, idempotencyKey): a retry returns the same group (200).
 * Insert-only, and no chart signal: these orders aren't paid.
 */
export const POST = route(
  { auth: "shopper", body: registerOrderBody, rate: { key: "orders.register", limit: 10, windowSec: 60 } },
  async ({ actor, body }) => {
    const r = await registerOrders(actor, body)
    return json(r.body, r.status)
  },
)
