import { appAttestChallengeBody, type AppAttestChallengeDto } from "@/lib/api/contracts/app-attest"
import { newChallenge } from "@/server/app-attest"
import { route } from "@/server/http/route"

/**
 * POST /api/app/attest/challenge { purpose: "request" | "register" } → { challenge, expiresAt }: a
 * single-use challenge for one protected request (or, "register", for one iOS key attestation),
 * valid ~5 minutes and stored only as its hash. { challenge: null } when attestation is off (for
 * "register": when iOS isn't configured). docs/APP.md "App attestation".
 */
export const POST = route(
  { auth: "public", body: appAttestChallengeBody, maxBody: 1024, rate: { key: "app.attest.challenge", limit: 30, windowSec: 60, anonGlobal: 3000 } },
  async ({ body }): Promise<AppAttestChallengeDto> => {
    const c = await newChallenge(body.purpose)
    return c ? { challenge: c.challenge, expiresAt: c.expiresAt.toISOString() } : { challenge: null, expiresAt: null }
  },
)
