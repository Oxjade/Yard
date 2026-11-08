import { mfaChallengeBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { startEnrolment } from "@/server/auth/mfa"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/mfa/enrol { challenge } → { secret, otpauthUrl }. Only with a challenge from
 * sign-in whose status was "mfa_enrol_required". Show the QR (otpauthUrl) and the secret once.
 */
export const POST = route({ auth: "public", body: mfaChallengeBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => startEnrolment(body.challenge, metaOf(req, ipHash)))
