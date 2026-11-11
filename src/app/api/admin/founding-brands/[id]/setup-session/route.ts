import { metaOf } from "@/server/auth/http"
import { endSetupSession, openSetupSession } from "@/server/catalog/founding"
import { json, route } from "@/server/http/route"

/**
 * POST /api/admin/founding-brands/{id}/setup-session (brands.founding) → 201 { brandId, expiresAt,
 * studioUrl }. Opens Studio on this unclaimed founding brand as "Yard setup" for 8 hours: it sets
 * this browser's brand cookie. Setup reaches catalogue, photos, collections, storefront and
 * shipping only, and every write is audited as this admin. Audited.
 */
export const POST = route({ auth: "admin", permission: "brands.founding", rate: { key: "admin.founding.setup", limit: 30, windowSec: 3600 } }, async ({ actor, params, req, ipHash }) =>
  json(await openSetupSession(actor, params.id, metaOf(req, ipHash)), 201),
)

/** DELETE /api/admin/founding-brands/{id}/setup-session (brands.founding): ends this admin's setup sessions on the brand and removes their setup access. */
export const DELETE = route({ auth: "admin", permission: "brands.founding", rate: { key: "admin.founding.setup", limit: 30, windowSec: 3600 } }, async ({ actor, params, req, ipHash }) => endSetupSession(actor, params.id, metaOf(req, ipHash)))
