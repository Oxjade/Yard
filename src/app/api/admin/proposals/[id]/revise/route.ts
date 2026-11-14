import { adminProposalReviseBody } from "@/server/catalog/contracts"
import { reviseProposal } from "@/server/catalog/proposals"
import { idParam } from "@/server/catalog/params"
import { json, route } from "@/server/http/route"

/** POST /api/admin/proposals/{id}/revise { product, note? } (catalog.propose): replaces a waiting suggestion; the old one is marked superseded and the brand is told again. Audited. 201 { proposal } (the new one). */
export const POST = route(
  { auth: "admin", permission: "catalog.propose", body: adminProposalReviseBody, maxBody: 256 * 1024, rate: { key: "admin.proposals.write", limit: 60, windowSec: 60, daily: 500 } },
  async ({ actor, params, body, ipHash }) => json(await reviseProposal(actor, idParam(params, "id"), body, ipHash), 201),
)
