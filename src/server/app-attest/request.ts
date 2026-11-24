import { createHash } from "node:crypto"
import type { AttestMode, Platform } from "./config"

/**
 * The request binding and the X-Yard-Attest header (docs/APP.md "App attestation"). Pure.
 *
 * The app asks for a challenge (POST /api/app/attest/challenge), then binds its attestation to
 * exactly one request with
 *
 *   clientData = "yard-attest/v1\n" + METHOD + "\n" + path + "\n" + hex(sha256(body bytes)) + "\n" + challenge
 *
 * Android sends hex(sha256(clientData)) as the Play Integrity requestHash; iOS signs
 * sha256(clientData) as the App Attest clientDataHash. The header is unpadded base64url of JSON:
 *
 *   Android: { "v": 1, "p": "android", "c": challenge, "t": integrityToken }
 *   iOS:     { "v": 1, "p": "ios", "c": challenge, "k": keyId, "a": base64(assertion) }
 */

export const ATTEST_HEADER = "x-yard-attest"
export const CLIENT_DATA_VERSION = "yard-attest/v1"

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest()
export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")

export function clientData(method: string, path: string, bodySha256Hex: string, challenge: string): string {
  return [CLIENT_DATA_VERSION, method.toUpperCase(), path, bodySha256Hex.toLowerCase(), challenge].join("\n")
}

/** The 32-byte clientDataHash (iOS) and its hex form, the requestHash (Android). */
export function clientDataHash(method: string, path: string, bodySha256Hex: string, challenge: string): Buffer {
  return sha256(clientData(method, path, bodySha256Hex, challenge))
}

export type AttestHeader = { platform: "android"; challenge: string; token: string } | { platform: "ios"; challenge: string; keyId: string; assertion: Buffer }

const CHALLENGE_RE = /^[A-Za-z0-9_-]{16,128}$/
const B64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/

/** The header, "malformed" when it is present but unreadable, or null when absent. */
export function parseAttestHeader(value: string | null | undefined): AttestHeader | "malformed" | null {
  if (value == null || !value.trim()) return null
  if (value.length > 16_384) return "malformed"
  let o: Record<string, unknown>
  try {
    o = JSON.parse(Buffer.from(value.trim(), "base64url").toString("utf8")) as Record<string, unknown>
  } catch {
    return "malformed"
  }
  if (!o || typeof o !== "object" || o.v !== 1 || typeof o.c !== "string" || !CHALLENGE_RE.test(o.c)) return "malformed"
  if (o.p === "android") {
    if (typeof o.t !== "string" || !o.t || o.t.length > 12_000) return "malformed"
    return { platform: "android", challenge: o.c, token: o.t }
  }
  if (o.p === "ios") {
    if (typeof o.k !== "string" || !B64_RE.test(o.k) || o.k.length > 100) return "malformed"
    if (typeof o.a !== "string" || !B64_RE.test(o.a) || o.a.length > 8_000) return "malformed"
    return { platform: "ios", challenge: o.c, keyId: o.k, assertion: Buffer.from(o.a, "base64") }
  }
  return "malformed"
}

/** Builds the header (tests and docs; the apps build the same JSON). */
export function encodeAttestHeader(h: AttestHeader): string {
  const o = h.platform === "android" ? { v: 1, p: "android", c: h.challenge, t: h.token } : { v: 1, p: "ios", c: h.challenge, k: h.keyId, a: h.assertion.toString("base64") }
  return Buffer.from(JSON.stringify(o)).toString("base64url")
}

/**
 * What the check found for one request that claims to be the app (no browser Sec-Fetch-* headers):
 *  - pass: a valid attestation for this request;
 *  - fail: a header that is malformed, replayed, for another request, or that the platform refused;
 *  - missing: no header;
 *  - skipped: a header for a platform whose settings are incomplete (that platform is off);
 *  - unavailable: Google could not be reached to decode the token (allowed, like a Turnstile outage).
 */
export type AttestVerdict = { result: "pass"; platform: Platform } | { result: "fail"; platform: Platform | null; reason: string } | { result: "missing" } | { result: "skipped"; platform: Platform } | { result: "unavailable"; platform: Platform }

/**
 * monitor never blocks. enforce blocks a fail, and a missing header only when BOTH platforms are
 * configured: while one is off, a caller without a header may be that platform's app, and a bot
 * could always claim it.
 */
export function decide(mode: AttestMode, verdict: AttestVerdict, configured: { android: boolean; ios: boolean }): "allow" | "block" {
  if (mode !== "enforce") return "allow"
  if (verdict.result === "fail") return "block"
  if (verdict.result === "missing") return configured.android && configured.ios ? "block" : "allow"
  return "allow"
}

/** The metrics_minutes event for a verdict (Admin › Health sums them). */
export function verdictEvent(v: AttestVerdict): string {
  switch (v.result) {
    case "pass":
      return `app_attest.pass.${v.platform}`
    case "fail":
      return `app_attest.fail.${v.platform ?? "unknown"}`
    case "missing":
      return "app_attest.missing"
    case "skipped":
      return `app_attest.skipped.${v.platform}`
    case "unavailable":
      return `app_attest.unavailable.${v.platform}`
  }
}
