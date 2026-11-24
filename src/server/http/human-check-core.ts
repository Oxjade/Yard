import type { HumanCheckFields } from "@/lib/api/contracts/human-check"

/**
 * The pure half of the bot check (human-check.ts has the whole story): which requests count as a
 * browser's, the honeypot and minimum fill time verdict, and whether Turnstile is configured. No
 * server-only import, so `tsx --test` can load it.
 */

export type HumanKind = "signup" | "reset" | "magic" | "apply"

/** Below these, nobody filled the form by hand. */
export const MIN_FILL_MS: Record<HumanKind, number> = { signup: 2500, reset: 1200, magic: 1200, apply: 4000 }

const blank = (v: string | undefined) => !v || !v.trim()

export function turnstileKeys(env: Record<string, string | undefined> = process.env) {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim()
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  return siteKey && secret ? { siteKey, secret } : null
}

/** A browser's request (fetch from a page) rather than an app's native HTTP client. */
export const fromWebBrowser = (headers: Headers) => headers.has("sec-fetch-site") || headers.has("sec-fetch-mode")

/** The pure part: honeypot and fill time. "bot" with the reason, or "ok". */
export function screen(fields: HumanCheckFields, kind: HumanKind, now = Date.now()): { verdict: "ok" } | { verdict: "bot"; reason: "honeypot" | "too_fast" } {
  if (!blank(fields.hp)) return { verdict: "bot", reason: "honeypot" }
  const started = fields.formStartedAt
  if (typeof started === "number" && Math.abs(now - started) < 86_400_000 && now - started < MIN_FILL_MS[kind]) return { verdict: "bot", reason: "too_fast" }
  return { verdict: "ok" }
}

