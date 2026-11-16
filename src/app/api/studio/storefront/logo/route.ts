import { route } from "@/server/http/route"
import { storefrontLogoBody } from "@/server/catalog/contracts"
import { setBrandLogo } from "@/server/catalog/storefront"

/**
 * PUT /api/studio/storefront/logo (content.publish): the brand's image logo. `logoMediaId` is one
 * of the brand's own uploads (POST /api/uploads?purpose=storefront_cover&as=brand), or null for
 * the text mark. Returns `{ logoSrc }` (the brand-scoped URL, null without a logo).
 */
export const PUT = route(
  { auth: "brand", permission: "content.publish", body: storefrontLogoBody, rate: { key: "studio.storefront.logo", limit: 20, windowSec: 60, daily: 200 } },
  async ({ actor, body, ipHash }) => setBrandLogo(actor, body, ipHash),
)
