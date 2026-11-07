import { complaintResponseBody } from "@/lib/api/contracts/shipping"
import { requireBrandResource } from "@/server/auth/dal"
import { route } from "@/server/http/route"
import { brandOrderLoader, respondToComplaint } from "@/server/shipping/orders"

/**
 * POST /api/studio/orders/{id}/complaint-response (orders.fulfil). The complaint's order must
 * belong to the active brand (else 404). Notifies the order's shopper (order_ref.customer_id),
 * never anyone the body names.
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: complaintResponseBody, maxBody: 8 * 1024, rate: { key: "studio.complaint_response", limit: 30, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const { resource } = await requireBrandResource(brandOrderLoader(params.id), "orders.fulfil")
    return { complaint: await respondToComplaint(actor, resource, body.message, ipHash) }
  },
)
