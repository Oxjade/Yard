import { studioDropListQuery } from "@/server/drops/contracts"
import { listBrandDrops } from "@/server/drops/service"
import { route } from "@/server/http/route"

/** GET /api/drops/studio?status=: every drop of the active brand, drafts included, with entry and reminder counts. */
export const GET = route({ auth: "brand", permission: "any_member", query: studioDropListQuery, rate: { key: "drops.studio", limit: 120, windowSec: 60 } }, async ({ actor, query }) => listBrandDrops(actor.brandId, query))
