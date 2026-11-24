import "server-only"
import { accessSync, constants } from "node:fs"
import type { NextRequest } from "next/server"
import { getShopper } from "../auth/dal"
import { db } from "../db"
import { log } from "../log"
import { countEvent } from "../monitoring/minutes"
import { verifyAssertion, verifyAttestation } from "./apple"
import { attestConfig, attestStartupLine, type AttestConfig } from "./config"
import { checkPlayVerdict, decodeIntegrityToken, GoogleUnavailable } from "./play-integrity"
import { ATTEST_HEADER, clientDataHash, decide, parseAttestHeader, verdictEvent, type AttestVerdict } from "./request"
import { advanceCounter, consumeChallenge, getKey, issueChallenge, saveKey, type ChallengePurpose, type Db } from "./store"

/**
 * App attestation for the endpoints a bot would hammer (sign-up, password reset, magic link, the
 * brand application): a request that claims to be the Yard app (no browser Sec-Fetch-* headers)
 * should carry X-Yard-Attest, made by Google Play Integrity (Android) or Apple App Attest (iOS)
 * for exactly this request. YARD_APP_ATTEST decides what happens (config.ts):
 *
 *  - off: nothing is checked;
 *  - monitor (default): checked, logged and counted (metrics_minutes app_attest.*), never blocked;
 *  - enforce: a failed attestation, or a missing one once both platforms are configured, gets the
 *    same answer as a failed human check (400 on `attest`).
 *
 * Google unreachable → allowed and counted as unavailable, so an outage never locks people out.
 * docs/APP.md "App attestation" has the wire format; docs/DEPLOY.md the owner's setup.
 */

export function currentConfig(): AttestConfig {
  return attestConfig(process.env)
}

/** The boot log line (instrumentation warm-up), once per process. */
export function logAttestConfig() {
  const c = currentConfig()
  log.once("app-attest-config", "info", attestStartupLine(c))
  if (c.mode !== "off" && c.android) {
    try {
      accessSync(c.android.credentialsPath, constants.R_OK)
    } catch {
      log.once("app-attest-credentials", "warn", "[yard] App attestation: GOOGLE_APPLICATION_CREDENTIALS_PLAY names a file this server can't read; Android tokens can't be decoded (requests are allowed, counted as unavailable).")
    }
  }
}

const handle = async () => (await db()) as unknown as Db

/** POST /api/app/attest/challenge. Null when attestation is off or no platform is configured. */
export async function newChallenge(purpose: ChallengePurpose) {
  const c = currentConfig()
  if (c.mode === "off" || (!c.android && !c.ios) || (purpose === "register" && !c.ios)) return null
  return issueChallenge(await handle(), purpose)
}

/** What the apps need before asking for a token (GET /api/app/attest/config). Public values only. */
export function publicConfig() {
  const c = currentConfig()
  const on = c.mode !== "off"
  return {
    mode: c.mode,
    android: on && c.android ? { cloudProjectNumber: c.android.cloudProjectNumber } : null,
    ios: on && c.ios ? { environment: c.ios.environment } : null,
  }
}

export type RegisterResult = { registered: true } | { registered: false; reason: string }

/** POST /api/app/attest/register: verifies an iOS key's attestation and stores the key. */
export async function registerIosKey(input: { keyId: string; attestation: Buffer; challenge: string }): Promise<RegisterResult> {
  const c = currentConfig()
  if (c.mode === "off" || !c.ios) return { registered: false, reason: "off" }
  const d = await handle()
  if (!(await consumeChallenge(d, input.challenge, "register"))) {
    countEvent("app_attest.register_fail")
    return { registered: false, reason: "challenge" }
  }
  const v = verifyAttestation({ attestation: input.attestation, keyId: input.keyId, challenge: input.challenge, appId: c.ios.appId, environment: c.ios.environment })
  if (!v.ok) {
    countEvent("app_attest.register_fail")
    throttledWarn(`register:${v.reason}`, `[yard] app attest: iOS key attestation refused (${v.reason})`)
    return { registered: false, reason: v.reason }
  }
  const shopper = await getShopper().catch(() => null)
  await saveKey(d, { keyId: input.keyId, publicKey: v.publicKeyPem, environment: c.ios.environment, userId: shopper?.userId ?? null })
  countEvent("app_attest.register_ok")
  return { registered: true }
}

/* ---------- the per-request check ---------- */

const lastWarn = new Map<string, number>()
/** At most one warning a minute per reason, so a flood of bad requests can't flood the log. */
function throttledWarn(key: string, message: string) {
  const now = Date.now()
  if ((lastWarn.get(key) ?? 0) > now - 60_000) return
  lastWarn.set(key, now)
  log.warn(message)
}

async function verifyRequest(req: NextRequest, bodySha256: string, c: AttestConfig): Promise<AttestVerdict> {
  const h = parseAttestHeader(req.headers.get(ATTEST_HEADER))
  if (h === null) return { result: "missing" }
  if (h === "malformed") return { result: "fail", platform: null, reason: "malformed" }
  if (h.platform === "android" && !c.android) return { result: "skipped", platform: "android" }
  if (h.platform === "ios" && !c.ios) return { result: "skipped", platform: "ios" }
  const d = await handle()
  // Single use: a replayed header fails here, before Google or the key is consulted.
  if (!(await consumeChallenge(d, h.challenge, "request"))) return { result: "fail", platform: h.platform, reason: "challenge" }
  const hash = clientDataHash(req.method, new URL(req.url).pathname, bodySha256, h.challenge)

  if (h.platform === "android") {
    const cfg = c.android!
    try {
      const payload = await decodeIntegrityToken(h.token, cfg)
      if (!payload) return { result: "fail", platform: "android", reason: "token_refused" }
      const v = checkPlayVerdict(payload, cfg, hash.toString("hex"))
      return v.ok ? { result: "pass", platform: "android" } : { result: "fail", platform: "android", reason: v.reason }
    } catch (e) {
      if (e instanceof GoogleUnavailable) {
        throttledWarn("google", `[yard] app attest: Play Integrity unavailable (${e.message}); request allowed`)
        return { result: "unavailable", platform: "android" }
      }
      throw e
    }
  }

  const cfg = c.ios!
  const key = await getKey(d, h.keyId)
  if (!key) return { result: "fail", platform: "ios", reason: "unknown_key" }
  if (key.environment !== cfg.environment) return { result: "fail", platform: "ios", reason: "environment" }
  const v = verifyAssertion({ assertion: h.assertion, clientDataHash: hash, publicKeyPem: key.publicKey, storedCounter: key.counter, appId: cfg.appId })
  if (!v.ok) return { result: "fail", platform: "ios", reason: v.reason }
  const shopper = await getShopper().catch(() => null)
  if (!(await advanceCounter(d, h.keyId, v.counter, shopper?.userId ?? null))) return { result: "fail", platform: "ios", reason: "counter_replay" }
  return { result: "pass", platform: "ios" }
}

export const ATTEST_MESSAGE = "Yard couldn't confirm this request came from the Yard app. Update the app and try again."

/**
 * The check for one request that claims to be the app. "block" only in enforce mode; the caller
 * answers it like a failed human check. `bodySha256` is the hex sha256 of the raw request body.
 */
export async function appAttestGate(req: NextRequest, bodySha256: string | null, kind: string): Promise<"allow" | "block"> {
  const c = currentConfig()
  if (c.mode === "off") return "allow"
  let verdict: AttestVerdict
  try {
    verdict = await verifyRequest(req, bodySha256 ?? "", c)
  } catch (e) {
    // Our own failure (database): never lock people out over it.
    log.error(`[yard] app attest: check failed for ${kind}`, e)
    return "allow"
  }
  countEvent(verdictEvent(verdict))
  const outcome = decide(c.mode, verdict, { android: !!c.android, ios: !!c.ios })
  if (verdict.result === "fail") throttledWarn(`fail:${verdict.platform}:${verdict.reason}`, `[yard] app attest: ${kind} ${verdict.platform ?? "unknown"} attestation failed (${verdict.reason}); ${outcome === "block" ? "refused" : `allowed (${c.mode})`}`)
  if (outcome === "block") countEvent(`app_attest.blocked.${kind}`)
  return outcome
}
