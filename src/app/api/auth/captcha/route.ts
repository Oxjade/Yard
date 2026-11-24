import { json, route } from "@/server/http/route"
import { captchaConfig } from "@/server/http/human-check"

/**
 * GET /api/auth/captcha → { provider: "turnstile", siteKey } when Turnstile is configured
 * (TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY), else { provider: null, siteKey: null }. The site
 * key is public by design (Cloudflare shows it in the page). Read at request time, never baked in.
 */
export const GET = route({ auth: "public", cache: "no-store", rate: { key: "auth.captcha", limit: 120, windowSec: 60 } }, async () => json(captchaConfig()))
