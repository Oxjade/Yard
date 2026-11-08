import { route } from "@/server/http/route"
import { intParam } from "@/server/catalog/params"
import { getStorefrontVersion } from "@/server/catalog/storefront"

/** GET /api/studio/storefront/versions/{version} (any member): one published version's full config. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.storefront.read", limit: 120, windowSec: 60 } }, async ({ actor, params }) => getStorefrontVersion(actor, intParam(params, "version")))
