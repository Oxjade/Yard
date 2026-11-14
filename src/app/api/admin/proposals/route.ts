import { adminProposalCreateBody, adminProposalsQuery } from "@/server/catalog/contracts"
import { createProposal, listAdminProposals } from "@/server/catalog/proposals"
import { json, route } from "@/server/http/route"

/** GET /api/admin/proposals?status=pending|accepted|declined|withdrawn|superseded|all&brandId=&q=&limit=&offset= (catalog.propose): Suggestions from Yard, newest change first, with counts by status. */
export const GET = route({ auth: "admin", permission: "catalog.propose", query: adminProposalsQuery, rate: { key: "admin.proposals", limit: 240, windowSec: 60 } }, async ({ query }) => listAdminProposals(query))

/**
 * POST /api/admin/proposals (catalog.propose): { kind: "new", brandId, product, note? } suggests a new
 * product; { kind: "edit", productId, product, note? } suggests changes (only the changed fields are
 * kept). One waiting suggestion per product (409). The brand is notified and emailed. Audited. 201 { proposal }.
 */
export const POST = route(
  { auth: "admin", permission: "catalog.propose", body: adminProposalCreateBody, maxBody: 256 * 1024, rate: { key: "admin.proposals.write", limit: 60, windowSec: 60, daily: 500 } },
  async ({ actor, body, ipHash }) => json(await createProposal(actor, body, ipHash), 201),
)
