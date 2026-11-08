import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { pathId } from "@/server/orders/access"
import { disputeEvidenceBody } from "@/server/orders/contracts"
import { orderActor } from "@/server/orders/core"
import { submitBrandEvidence } from "@/server/orders/disputes"
import { toDisputeDto } from "@/server/orders/views"

/** POST /api/studio/orders/{id}/disputes/{disputeId}/evidence (orders.fulfil): the brand's account of the order for Yard to submit to the provider. */
export const POST = route(
  { auth: "brand", permission: "orders.fulfil", body: disputeEvidenceBody, maxBody: 16 * 1024, rate: { key: "studio.dispute_evidence", limit: 20, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const row = await withTx((tx) => submitBrandEvidence(tx, { orderRefId: pathId(params.id), disputeId: pathId(params.disputeId), brandId: actor.brandId, actor: orderActor(actor), evidence: body.evidence, ipHash }))
    return { dispute: toDisputeDto(row, "brand") }
  },
)
