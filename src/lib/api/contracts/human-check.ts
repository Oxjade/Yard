import { z } from "zod"

/**
 * Bot protection fields the website's forms add to sign-up, password reset, magic-link and brand
 * application requests (src/server/http/human-check.ts). All optional: the mobile apps call the
 * same endpoints without them (docs/APP.md "Bot protection").
 *  - turnstileToken: the Cloudflare Turnstile token, when the server has Turnstile keys;
 *  - hp: a honeypot input people never see or fill; any value marks the request as a bot;
 *  - formStartedAt: when the form appeared (ms since epoch), for the minimum fill time.
 */
export const humanCheckFields = {
  turnstileToken: z.string().max(2048).optional(),
  hp: z.string().max(500).optional(),
  formStartedAt: z.number().int().nonnegative().optional(),
}

export type HumanCheckFields = { turnstileToken?: string; hp?: string; formStartedAt?: number }

/** GET /api/auth/captcha: whether the website shows the Turnstile widget, and its public site key. */
export type CaptchaConfigDto = { provider: "turnstile"; siteKey: string } | { provider: null; siteKey: null }

/** The honeypot input's name: nothing a browser or password manager autofills. */
export const HONEYPOT_NAME = "yard_hp_contact_fax"
