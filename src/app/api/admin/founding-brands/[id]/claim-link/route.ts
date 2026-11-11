import { claimLinkBody } from "@/lib/api/contracts/founding"
import { metaOf } from "@/server/auth/http"
import { issueClaimLink, revokeClaimLink } from "@/server/catalog/founding"
import { json, route } from "@/server/http/route"

/**
 * POST /api/admin/founding-brands/{id}/claim-link { email, idempotencyKey } (brands.founding,
 * re-auth within 10 minutes: 403 fields.reauth = "required") → 201 { url, link, created }.
 * Emails the owner a single-use link that expires in 7 days and replaces any earlier link. The
 * URL is returned to copy (only its hash is stored); a retry with the same key returns the same
 * link (200) without a second email. 10 an hour and 30 a day per brand. Audited.
 */
export const POST = route(
  { auth: "admin", permission: "brands.founding", body: claimLinkBody, maxBody: 2048, rate: { key: "admin.founding.claim_link", limit: 30, windowSec: 3600, daily: 100 } },
  async ({ actor, params, body, req, ipHash }) => {
    const r = await issueClaimLink(actor, params.id, body, metaOf(req, ipHash))
    return json(r, r.created ? 201 : 200)
  },
)

/** DELETE /api/admin/founding-brands/{id}/claim-link (brands.founding): revokes the pending link (404 when none). Audited. */
export const DELETE = route({ auth: "admin", permission: "brands.founding", rate: { key: "admin.founding.claim_link", limit: 30, windowSec: 3600 } }, async ({ actor, params, req, ipHash }) => revokeClaimLink(actor, params.id, metaOf(req, ipHash)))
