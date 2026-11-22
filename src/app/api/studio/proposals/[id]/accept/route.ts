import { studioProposalAcceptBody } from "@/server/catalog/contracts"
import { acceptProposal } from "@/server/catalog/proposals"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/**
 * POST /api/studio/proposals/{id}/accept { product? } (content.publish): a new product is created and
 * published (as a draft while the brand can't publish yet); an edit applies only the suggested fields.
 * `product`: the brand's own edit of the suggestion, applied instead. 409 once answered. Audited.
 * → { proposal, productId, published }.
 */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: studioProposalAcceptBody, maxBody: 256 * 1024, rate: { key: "studio.proposals.decide", limit: 30, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const { proposal, productId, published } = await acceptProposal(actor, idParam(params, "id"), body.product, ipHash)
    return { proposal, productId, published }
  },
)
