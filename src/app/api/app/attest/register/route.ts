import { appAttestRegisterBody, type AppAttestRegisterDto } from "@/lib/api/contracts/app-attest"
import { registerIosKey } from "@/server/app-attest"
import { route } from "@/server/http/route"

/**
 * POST /api/app/attest/register { keyId, attestation, challenge } (the iOS app, once per install):
 * verifies the App Attest attestation (Apple's root, this app, this challenge, counter 0) and stores
 * the key → { registered: true }; otherwise { registered: false, reason } and the app keeps no key.
 * docs/APP.md "App attestation".
 */
export const POST = route(
  { auth: "public", body: appAttestRegisterBody, maxBody: 24 * 1024, rate: { key: "app.attest.register", limit: 10, windowSec: 60, anonGlobal: 600 } },
  async ({ body }): Promise<AppAttestRegisterDto> => registerIosKey({ keyId: body.keyId, attestation: Buffer.from(body.attestation, "base64"), challenge: body.challenge }),
)
