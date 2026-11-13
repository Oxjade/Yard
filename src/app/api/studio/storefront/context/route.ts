import { route } from "@/server/http/route"
import { ownStorefrontContext } from "@/server/catalog/public"

/** GET /api/studio/storefront/context (any member, Yard setup included): the session brand's profile, live storefront, collections and publishable products for the editor. Works before a founding brand has launched. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.storefront.read", limit: 120, windowSec: 60 }, cache: "no-store" }, async ({ actor }) => ownStorefrontContext(actor.brandId))
