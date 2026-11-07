import { shipmentEventBody } from "@/lib/api/contracts/shipping"
import { requireBrandResource } from "@/server/auth/dal"
import { rateLimited } from "@/server/http/errors"
import { json, route } from "@/server/http/route"
import { hit, recordAbuse } from "@/server/security/rate-limit"
import { brandOrderLoader, recordShipment } from "@/server/shipping/orders"

/** §5.1: shipment events are 300 an hour per brand, whichever members record them. */
const BRAND_LIMIT = 300
const BRAND_WINDOW_SEC = 3600

/**
 * POST /api/studio/orders/{id}/shipment (orders.fulfil). The order must belong to the active brand
 * (else 404) and be in a state that can take the event (else 422, see shipmentRefusal). Inserts the
 * event, recomputes the estimate, publishes order.estimate to the order's shopper and notifies them
 * (shipped, or running late at most once a day). Limits: 300 an hour per member (route) and 300
 * an hour for the whole brand (below).
 */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: shipmentEventBody, maxBody: 8 * 1024, rate: { key: "studio.shipment", limit: BRAND_LIMIT, windowSec: BRAND_WINDOW_SEC } },
  async ({ actor, params, body, ipHash }) => {
    const { resource } = await requireBrandResource(brandOrderLoader(params.id), "orders.fulfil")
    const key = `studio.shipment:brandwide:${actor.brandId}`
    const r = hit(key, BRAND_LIMIT, BRAND_WINDOW_SEC)
    if (!r.ok) {
      await recordAbuse(key, { kind: "brand", id: actor.userId, ipHash }, "studio.shipment", "rate_limit", { limit: BRAND_LIMIT, windowSec: BRAND_WINDOW_SEC, scope: "brand" }).catch(() => {})
      throw rateLimited(r.retryAfter, `${actor.brand.name} has recorded a lot of shipment updates this hour. Try again in a few minutes.`)
    }
    return json(await recordShipment(actor, resource, body, ipHash), 201)
  },
)
