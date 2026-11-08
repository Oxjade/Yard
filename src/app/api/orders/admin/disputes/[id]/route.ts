import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { pathId } from "@/server/orders/access"
import { adminDisputeUpdateBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"
import { adminUpdateDispute } from "@/server/orders/disputes"
import { toDisputeDto } from "@/server/orders/views"

/**
 * PATCH /api/orders/admin/disputes/{id} (admin, shipping.resolve): internal note, "response
 * submitted to the provider", under review / closed. Won and lost come only from the provider. Audited.
 */
export const PATCH = route(
  { auth: "admin", permission: "shipping.resolve", body: adminDisputeUpdateBody, maxBody: 8 * 1024, rate: { key: "admin.dispute_update", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const row = await withTx((tx) => adminUpdateDispute(tx, { disputeId: pathId(params.id), actor: orderActor(actor), ipHash, ...body }))
    return { dispute: toDisputeDto(row, "admin") }
  },
)
