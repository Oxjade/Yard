import { route } from "@/server/http/route"
import { byBrand } from "@/server/inbox/service"

/** GET /api/inbox/conversations/by-brand/{brandId}: the existing thread with a brand, and whether a message would go through. */
export const GET = route({ auth: "shopper", rate: { key: "inbox.list", limit: 120, windowSec: 60 } }, async ({ actor, params }) => byBrand(actor, params.brandId))
