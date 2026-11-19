import { adminPieceActionBody } from "@/lib/api/contracts/imports"
import { idParam } from "@/server/catalog/params"
import { adminPieceAction } from "@/server/catalog/importer/watch"
import { route } from "@/server/http/route"

/**
 * POST /api/admin/website-pieces/{id} { action } (catalog.propose; + brands.founding for an
 * unclaimed founding brand) → the brand's watch: "approve" copies the photos into Yard and makes a
 * Suggestion from Yard; "skip" passes on it for good; "dismiss_change" clears a "Changes on their
 * site" flag. 409 when the brand got there first. Audited.
 */
export const POST = route(
  { auth: "admin", permission: "catalog.propose", body: adminPieceActionBody, rate: { key: "admin.website_pieces.act", limit: 120, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => adminPieceAction(actor, idParam(params, "id"), body.action, ipHash),
)
