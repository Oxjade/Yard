import { route } from "@/server/http/route"
import { orderDetail } from "@/server/orders"
import { pathId } from "@/server/orders/access"

/** GET /api/studio/orders/{id} (any member; the active brand's order only, else 404): full order with address, returns, refunds, disputes, timeline. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.order", limit: 240, windowSec: 60 } }, async ({ actor, params }) => ({ order: await orderDetail("brand", pathId(params.id), { brandId: actor.brandId }) }))
