import { idParam } from "@/server/catalog/params"
import { publishForBrand, publishForBrandPreview } from "@/server/catalog/publish-for-brand"
import { json, route } from "@/server/http/route"

/**
 * GET /api/admin/brand-storefronts/{brandId} (brands.restrict) → what "Publish storefront for
 * {brand}" would put live: published?, the checklist (logo, banner, intro, live products, with
 * "Shop will show as empty" at 0), why it's blocked if it is, payout account, go-live-on-claim.
 */
export const GET = route({ auth: "admin", permission: "brands.restrict", rate: { key: "admin.brand_storefront.read", limit: 240, windowSec: 60 } }, async ({ actor, params }) =>
  publishForBrandPreview(actor, idParam(params, "brandId")),
)

/**
 * POST /api/admin/brand-storefronts/{brandId} (brands.restrict; an unclaimed founding brand also
 * needs brands.founding) → 201 { created: true, version, emailed, preview } or 200 { created: false }
 * when it was already published (a no-op). The brand's own publish with its own checks, recorded
 * with the admin as publisher; audited brand.storefront_published_by_yard; emails "You're live" once.
 */
export const POST = route({ auth: "admin", permission: "brands.restrict", rate: { key: "admin.brand_storefront.publish", limit: 30, windowSec: 3600, daily: 200 } }, async ({ actor, params, ipHash }) => {
  const r = await publishForBrand(actor, idParam(params, "brandId"), ipHash)
  return json(r, r.created ? 201 : 200)
})
