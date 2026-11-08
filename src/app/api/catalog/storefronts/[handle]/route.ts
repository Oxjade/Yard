import { route } from "@/server/http/route"
import { publicStorefront } from "@/server/catalog/public"
import { idParam } from "@/server/catalog/params"

/** GET /api/catalog/storefronts/{handle or brand id} (public): the live storefront version, the brand and its published collections. */
export const GET = route({ auth: "public", rate: { key: "catalog.storefront", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 30, swr: 60 } }, async ({ params }) => publicStorefront(idParam(params, "handle")))
