import { claimPreviewBody } from "@/lib/api/contracts/founding"
import { previewClaim } from "@/server/auth/claims"
import { getShopper } from "@/server/auth/dal"
import { metaOf } from "@/server/auth/http"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/claim/preview { token } (public): the founding brand behind a claim link, the
 * masked email, whether to sign in first (hasAccount) or whether the signed-in shopper is the
 * invited account (signedInMatches), the expiry and the seller agreement version. Refusals:
 * invalid 404, expired 410, revoked 410, used 409, brand on hold 403 (fields.link says which).
 */
export const POST = route({ auth: "public", body: claimPreviewBody, maxBody: 1024, rate: { key: "auth.claim.preview", limit: 30, windowSec: 600, anonGlobal: 600 } }, async ({ body, req, ipHash }) =>
  previewClaim(body.token, await getShopper(), metaOf(req, ipHash)),
)
