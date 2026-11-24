import "server-only"
import type { NextRequest } from "next/server"
import type { CaptchaConfigDto, HumanCheckFields } from "@/lib/api/contracts/human-check"
import { appAttestGate, ATTEST_MESSAGE } from "../app-attest"
import { log } from "../log"
import { countEvent } from "../monitoring/minutes"
import { badRequest } from "./errors"

/**
 * Bot protection for the endpoints a bot would hammer: sign-up, password reset, magic link and the
 * brand application. Three layers, on top of the per-IP and per-email rate limits (auth/limits.ts):
 *
 *  1. Honeypot (always on): a hidden input people never fill. Filled → a bot.
 *  2. Minimum fill time (always on when the form sends formStartedAt): faster than a person can
 *     type → a bot. A clock that is off by more than a day is ignored rather than trusted.
 *  3. Cloudflare Turnstile (free), only when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both
 *     set; otherwise it is off and never blocks. Required for requests from a web browser (they
 *     carry Sec-Fetch-* headers); the mobile apps' native HTTP client sends none and is exempt, and
 *     relies on the rate limits, the honeypot (the app sends none, so it never trips) and email
 *     verification instead (docs/APP.md). A token that is sent is always verified. If Cloudflare
 *     can't be reached the request goes ahead (logged), so an outage there never locks people out.
 *  4. App attestation, for requests that claim to be the app (no Sec-Fetch-*): Play Integrity or
 *     App Attest in the X-Yard-Attest header, bound to this request (src/server/app-attest).
 *     YARD_APP_ATTEST=monitor (default) only counts; enforce refuses like a failed Turnstile check.
 *
 * A bot verdict is silent where the endpoint already gives every caller the same answer (sign-up,
 * reset, magic link): the caller returns that answer and nothing is created or sent.
 */

import { fromWebBrowser, screen, turnstileKeys, type HumanKind } from "./human-check-core"

export { fromWebBrowser, MIN_FILL_MS, screen, turnstileKeys, type HumanKind } from "./human-check-core"

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export function captchaConfig(): CaptchaConfigDto {
  const keys = turnstileKeys()
  return keys ? { provider: "turnstile", siteKey: keys.siteKey } : { provider: null, siteKey: null }
}

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<"ok" | "failed" | "unreachable"> {
  try {
    const form = new URLSearchParams({ secret, response: token })
    if (ip) form.set("remoteip", ip)
    const res = await fetch(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return "unreachable"
    const out = (await res.json()) as { success?: boolean }
    return out.success === true ? "ok" : "failed"
  } catch {
    return "unreachable"
  }
}

const CHALLENGE_MESSAGE = "Complete the quick check above, then try again."

/**
 * Runs the layers. Returns "bot" for the caller to answer silently (or refuse); throws a 400 on
 * `turnstile` when the Turnstile check is required and missing or failed, and on `attest` when
 * app attestation is enforced and the app's request isn't attested. `bodySha256` is the route's
 * hex sha256 of the raw body (RouteContext.bodySha256), which the attestation is bound to.
 */
export async function humanCheck(req: NextRequest, fields: HumanCheckFields, kind: HumanKind, ip: string | null, bodySha256: string | null = null): Promise<"ok" | "bot"> {
  const s = screen(fields, kind)
  if (s.verdict === "bot") {
    countEvent(`human.bot.${kind}`)
    log.warn(`[yard] human-check: ${kind} refused as a bot (${s.reason})`)
    return "bot"
  }
  if (!fromWebBrowser(req.headers) && (await appAttestGate(req, bodySha256, kind)) === "block") {
    throw badRequest({ attest: ATTEST_MESSAGE }, ATTEST_MESSAGE)
  }
  const keys = turnstileKeys()
  if (!keys) return "ok"
  const token = fields.turnstileToken?.trim()
  if (!token) {
    if (!fromWebBrowser(req.headers)) return "ok"
    countEvent(`human.challenge_missing.${kind}`)
    throw badRequest({ turnstile: CHALLENGE_MESSAGE }, CHALLENGE_MESSAGE)
  }
  const v = await verifyTurnstile(keys.secret, token, ip)
  if (v === "unreachable") {
    log.warn(`[yard] human-check: Turnstile unreachable; ${kind} allowed`)
    return "ok"
  }
  if (v === "failed") {
    countEvent(`human.challenge_failed.${kind}`)
    throw badRequest({ turnstile: CHALLENGE_MESSAGE }, CHALLENGE_MESSAGE)
  }
  return "ok"
}

/** Picks the human-check fields off a parsed body and returns the rest. */
export function splitHuman<T extends HumanCheckFields>(body: T): { human: HumanCheckFields; rest: Omit<T, keyof HumanCheckFields> } {
  const { turnstileToken, hp, formStartedAt, ...rest } = body
  return { human: { turnstileToken, hp, formStartedAt }, rest }
}
