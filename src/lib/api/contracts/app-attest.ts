import { z } from "zod"

/**
 * App attestation for the Yard apps (docs/APP.md "App attestation", src/server/app-attest).
 *
 *  - GET /api/app/attest/config → AppAttestConfigDto: whether to attest, and the public values the
 *    apps need (Android: the Cloud project number for Play Integrity).
 *  - POST /api/app/attest/challenge { purpose } → AppAttestChallengeDto: a single-use challenge
 *    (~5 minutes), or { challenge: null } when attestation is off for every platform.
 *  - POST /api/app/attest/register { keyId, attestation, challenge } (iOS): registers an App Attest
 *    key → { registered: true } or { registered: false, reason }.
 */

export type AppAttestConfigDto = {
  mode: "off" | "monitor" | "enforce"
  android: { cloudProjectNumber: string } | null
  ios: { environment: "production" | "development" } | null
}

export type AppAttestChallengeDto = { challenge: string; expiresAt: string } | { challenge: null; expiresAt: null }

export type AppAttestRegisterDto = { registered: true } | { registered: false; reason: string }

export const appAttestChallengeBody = z.strictObject({ purpose: z.enum(["request", "register"]) })

const base64 = (max: number) => z.string().min(4).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Send base64.")

export const appAttestRegisterBody = z.strictObject({
  /** From DCAppAttestService.generateKey (base64 of the key's sha256). */
  keyId: base64(64),
  /** The attestation object from attestKey, base64. */
  attestation: base64(16_000),
  /** The challenge from POST /api/app/attest/challenge { purpose: "register" }. */
  challenge: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, "Send the challenge as received."),
})
