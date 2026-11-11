import { foundingPatchBody } from "@/lib/api/contracts/founding"
import { getFoundingBrand, updateFoundingBrand } from "@/server/catalog/founding"
import { route } from "@/server/http/route"

/** GET /api/admin/founding-brands/{id} (brands.founding): one founding brand row (as in the list). */
export const GET = route({ auth: "admin", permission: "brands.founding", rate: { key: "admin.founding.read", limit: 120, windowSec: 60 } }, async ({ params }) => getFoundingBrand(params.id))

/**
 * PATCH /api/admin/founding-brands/{id} { name?, city?, story?, instagram?, tiktok?, logoMediaId?,
 * bannerMediaId?, foundingBadge? } (brands.founding). Logo and banner must be uploads of this brand
 * (POST /api/uploads?as=admin&purpose=storefront_cover&brandId=); the banner goes into the storefront
 * draft as its cover. Once claimed only `foundingBadge` can change (422 otherwise). Audited.
 */
export const PATCH = route(
  { auth: "admin", permission: "brands.founding", body: foundingPatchBody, maxBody: 16 * 1024, rate: { key: "admin.founding.update", limit: 60, windowSec: 60, daily: 1000 } },
  async ({ actor, params, body, ipHash }) => updateFoundingBrand(actor, params.id, body, ipHash),
)
