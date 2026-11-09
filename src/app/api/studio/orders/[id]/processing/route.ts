import { withTx } from "@/server/db"
import { json, route } from "@/server/http/route"
import { pathId } from "@/server/orders/access"
import { orderDetail } from "@/server/orders"
import { orderActor } from "@/server/orders/core"
import { markProcessing } from "@/server/orders/fulfilment"

/** POST /api/studio/orders/{id}/processing (orders.fulfil): starts packing a paid order. */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", rate: { key: "studio.order_processing", limit: 60, windowSec: 60 } },
  async ({ actor, params }) => {
    const id = pathId(params.id)
    const result = await withTx((tx) => markProcessing(tx, { orderRefId: id, brandId: actor.brandId, actor: orderActor(actor) }))
    return json({ ...result, order: await orderDetail("brand", id, { brandId: actor.brandId }) }, result.alreadyProcessing ? 200 : 201)
  },
)