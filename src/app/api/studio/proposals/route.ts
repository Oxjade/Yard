import { studioProposalsQuery } from "@/server/catalog/contracts"
import { listStudioProposals } from "@/server/catalog/proposals"
import { route } from "@/server/http/route"

/** GET /api/studio/proposals?status=pending|all (any member): the active brand's Suggestions from Yard, newest first, with counts. */
export const GET = route({ auth: "brand", permission: "any_member", query: studioProposalsQuery, rate: { key: "studio.proposals", limit: 240, windowSec: 60 } }, async ({ actor, query }) => listStudioProposals(actor, query))
