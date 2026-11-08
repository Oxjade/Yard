import { mfaConfirmBody } from "@/server/auth/contracts"
import { metaOf } from "@/server/auth/http"
import { confirmEnrolment } from "@/server/auth/mfa"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/mfa/enrol/confirm { challenge, code } → { status: "signed_in", actor: "admin",
 * profile, recoveryCodes } (cookie set). The recovery codes are shown once.
 */
export const POST = route({ auth: "public", body: mfaConfirmBody, maxBody: 2 * 1024 }, async ({ req, body, ipHash }) => confirmEnrolment(body.challenge, body.code, metaOf(req, ipHash)))
