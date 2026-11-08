import { mfaVerifyBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { verifyChallenge } from "@/server/auth/mfa"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/mfa/verify { challenge, code } | { challenge, recoveryCode }
 *  → { status: "signed_in", actor: "admin", profile, recoveryCodesLeft } (cookie set).
 * Five wrong codes end the challenge (sign in again).
 */
export const POST = route({ auth: "public", body: mfaVerifyBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => verifyChallenge(body.challenge, { code: body.code, recoveryCode: body.recoveryCode }, metaOf(req, ipHash)))
