import { route } from "@/server/http/route"
import { pathId } from "@/server/orders/access"
import { studioCourier } from "@/server/shipping/courier-book"

/** GET /api/studio/orders/{id}/courier (any member; the active brand's order only, else 404): the courier rate the shopper paid, and the booking once there is one. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.order.courier", limit: 240, windowSec: 60 } }, async ({ actor, params }) => studioCourier(actor, pathId(params.id)))
