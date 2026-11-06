import { complaintBody } from "@/lib/api/contracts/shipping"
import { json, route } from "@/server/http/route"
import { fileComplaint, shopperOrder } from "@/server/shipping/orders"

/**
 * POST /api/orders/{id}/delivery-complaints (shopper, owner only, else 404; 5 a day). The
 * complaint's customer and brand are copied from the order, never from the body. The brand is
 * notified with template text only.
 */
export const POST = route(
  { auth: "shopper", body: complaintBody, maxBody: 8 * 1024, rate: { key: "orders.complaint", limit: 5, windowSec: 60, daily: 5 } },
  async ({ actor, params, body }) => json(await fileComplaint(actor, await shopperOrder(actor, params.id), body), 201),
)
