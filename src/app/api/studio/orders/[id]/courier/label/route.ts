import { route } from "@/server/http/route"
import { pathId } from "@/server/orders/access"
import { courierLabelHtml } from "@/server/shipping/courier-label"

/** GET /api/studio/orders/{id}/courier/label (any member; the active brand's booked order only): a printable 100 × 150 mm parcel label (HTML). */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.order.courier.label", limit: 60, windowSec: 60 } }, async ({ actor, params }) => {
  const html = await courierLabelHtml(actor.brandId, pathId(params.id))
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:", "X-Content-Type-Options": "nosniff" } })
})
