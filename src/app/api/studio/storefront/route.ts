import { route } from "@/server/http/route"
import { getStudioStorefront } from "@/server/catalog/storefront"

/** GET /api/studio/storefront (any member): the working draft (created from the live version on first read), the live version and the publish history. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.storefront.read", limit: 120, windowSec: 60 } }, async ({ actor }) => getStudioStorefront(actor))
