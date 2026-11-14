import { adminProposalContextQuery } from "@/server/catalog/contracts"
import { adminProposalContext } from "@/server/catalog/proposals"
import { route } from "@/server/http/route"

/** GET /api/admin/proposals/context?brandId= | ?productId= (catalog.propose): the brand, its products and collections (and the product) for the suggestion form. */
export const GET = route({ auth: "admin", permission: "catalog.propose", query: adminProposalContextQuery, rate: { key: "admin.proposals", limit: 240, windowSec: 60 } }, async ({ query }) => adminProposalContext(query))
