import { z } from "zod"
import { safeLine } from "@/lib/api/contracts/common"
import { proposalBrands } from "@/server/catalog/proposals"
import { route } from "@/server/http/route"

/** GET /api/admin/proposals/brands?q= (catalog.propose): up to 30 brands to suggest a product to, by name or handle. */
export const GET = route({ auth: "admin", permission: "catalog.propose", query: z.object({ q: safeLine({ max: 60 }).optional() }), rate: { key: "admin.proposals", limit: 240, windowSec: 60 } }, async ({ query }) => proposalBrands(query.q))
