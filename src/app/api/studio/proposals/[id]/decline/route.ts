import { studioProposalDeclineBody } from "@/server/catalog/contracts"
import { declineProposal } from "@/server/catalog/proposals"
import { idParam } from "@/server/catalog/params"
import { route } from "@/server/http/route"

/** POST /api/studio/proposals/{id}/decline { reason? } (content.publish): nothing changes; Yard is told. 409 once answered. Audited. */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: studioProposalDeclineBody, maxBody: 4 * 1024, rate: { key: "studio.proposals.decide", limit: 30, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => declineProposal(actor, idParam(params, "id"), body.reason, ipHash),
)
