import { adminPiecesBulkBody } from "@/lib/api/contracts/imports"
import { adminApproveAll } from "@/server/catalog/importer/watch"
import { json, route } from "@/server/http/route"

/**
 * POST /api/admin/website-pieces { brandId, action: "approve_all" } (catalog.propose) → 202 { ...watch,
 * taken }: takes every waiting "New from their website" piece for Yard at once (the brand can't
 * add them meanwhile), then makes each a Suggestion from Yard in the background; the brand hears
 * once for the batch. Audited catalog.website_pieces_approve_all, then per piece.
 */
export const POST = route(
  { auth: "admin", permission: "catalog.propose", body: adminPiecesBulkBody, rate: { key: "admin.website_pieces.bulk", limit: 20, windowSec: 3600 } },
  async ({ actor, body, ipHash }) => json(await adminApproveAll(actor, body.brandId, ipHash), 202),
)
