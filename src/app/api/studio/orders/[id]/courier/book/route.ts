import { bookPickupBody } from "@/lib/api/contracts/shipping"
import { route } from "@/server/http/route"
import { pathId } from "@/server/orders/access"
import { bookPickup } from "@/server/shipping/courier-book"

/**
 * POST /api/studio/orders/{id}/courier/book (orders.fulfil; the active brand's own order, else 404).
 * Books the courier the shopper paid for with Yard's courier wallet, saves the tracking code and
 * label, and moves the order to shipped. Idempotent: the order's one booking is claimed before the
 * provider is called, so repeats return the booking already made (or 409 while one is in flight).
 * An expired rate is re-quoted; Yard absorbs a higher price (Admin is told above the cap).
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: bookPickupBody, maxBody: 1024, rate: { key: "studio.order.courier.book", limit: 30, windowSec: 60 } },
  async ({ actor, params, ipHash }) => bookPickup(actor, pathId(params.id), ipHash),
)
