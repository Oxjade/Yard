import { claimAcceptBody } from "@/lib/api/contracts/founding"
import { acceptClaim } from "@/server/auth/claims"
import { getShopper } from "@/server/auth/dal"
import { metaOf } from "@/server/auth/http"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/claim/accept { token, acceptAgreement: true, agreementVersion, name?, password? }
 * (public) → { status: "signed_in", actor: "brand", profile, brandId, redirect }. Signed in as the
 * invited email (shopper session), or creating the account here when none has it. The claimant
 * becomes the brand's owner, Yard setup access ends and a brand session opens; the redirect goes
 * to Studio → Settings → payout account. Rate limited per IP and per link; refusals audited.
 */
export const POST = route({ auth: "public", body: claimAcceptBody, maxBody: 4096, rate: { key: "auth.claim.accept", limit: 20, windowSec: 600, anonGlobal: 300 } }, async ({ body, req, ipHash }) =>
  acceptClaim(body, await getShopper(), metaOf(req, ipHash)),
)
