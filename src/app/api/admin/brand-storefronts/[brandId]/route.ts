import { adminPublishStorefront, adminStorefrontPreview, adminUnpublishStorefront } from "@/server/catalog/admin-storefront"
import { idParam } from "@/server/catalog/params"
import { json, route } from "@/server/http/route"

/**
 * GET /api/admin/brand-storefronts/{brandId} (brands.restrict) → what "Publish storefront" would put
 * live: published?, the checklist (logo, banner, intro, live products, with "Shop will show as
 * empty" at 0), why it's blocked if it is, payout account, go-live-on-claim, and `storefront`: the
 * Publish / Unpublish state (live, live products, the masked payout account and its status,
 * blockers and warnings) for Admin › Brands (catalog/admin-storefront.ts).
 */
export const GET = route({ auth: "admin", permission: "brands.restrict", rate: { key: "admin.brand_storefront.read", limit: 240, windowSec: 60 } }, async ({ actor, params }) =>
  adminStorefrontPreview(actor, idParam(params, "brandId")),
)

/**
 * POST /api/admin/brand-storefronts/{brandId} (brands.restrict; an unclaimed founding brand also
 * needs brands.founding) → 201 { created: true, version, emailed, preview } or 200 { created: false }
 * when it was already live (a no-op). Never published: the brand's own publish with its own checks,
 * recorded with the admin as publisher, audited brand.storefront_published_by_yard. Unpublished by
 * Yard: back on the marketplace, audited brand.storefront_republished_by_yard. Emails "You're live" once.
 */
export const POST = route({ auth: "admin", permission: "brands.restrict", rate: { key: "admin.brand_storefront.publish", limit: 30, windowSec: 3600, daily: 200 } }, async ({ actor, params, ipHash }) => {
  const r = await adminPublishStorefront(actor, idParam(params, "brandId"), ipHash)
  return json(r, r.created ? 201 : 200)
})

/**
 * DELETE /api/admin/brand-storefronts/{brandId} (brands.restrict; an unclaimed founding brand also
 * needs brands.founding) → { changed, preview }: Unpublish storefront. The shop, its products and
 * its listing leave the marketplace (brands.unpublished_at) without restricting the brand; audited
 * brand.storefront_unpublished_by_yard.
 */
export const DELETE = route({ auth: "admin", permission: "brands.restrict", rate: { key: "admin.brand_storefront.publish", limit: 30, windowSec: 3600, daily: 200 } }, async ({ actor, params, ipHash }) =>
  adminUnpublishStorefront(actor, idParam(params, "brandId"), ipHash),
)
