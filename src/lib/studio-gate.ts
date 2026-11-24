/**
 * Brand Studio's front door in production (src/proxy.ts). No imports, so the proxy (bundled apart
 * from the app) and `tsx --test` share it.
 *
 * With the demo switch off, every /studio page except the public entry pages (sign-in and the
 * apply/onboarding wizard) needs a brand session. A request without the brand session cookie is
 * sent to /studio/sign-in?next=<the page>, before anything renders, so a signed-out visitor never
 * receives a workspace page at all. The cookie is only looked for here, not verified: an expired or
 * revoked session still reaches the page, where the Studio shell asks /api/session and sends it to
 * sign-in too (and every Studio API checks the session itself). The demo and development pass
 * straight through, exactly as before.
 */

export const STUDIO_SIGN_IN_PATH = "/studio/sign-in"
export const STUDIO_ONBOARDING_PATH = "/studio/onboarding"

/** The brand session cookie (server/auth/session.ts sessionPolicy.brand), plain or __Host- when Secure. */
export const BRAND_SESSION_COOKIES = ["yard_b", "__Host-yard_b"] as const

/** Studio pages anyone may open: signing in, and applying to sell (the onboarding wizard). */
const PUBLIC_STUDIO_PATHS = [STUDIO_SIGN_IN_PATH, STUDIO_ONBOARDING_PATH]

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

export const isStudioPath = (path: string) => under(path, "/studio")
export const isPublicStudioPath = (path: string) => PUBLIC_STUDIO_PATHS.some((p) => under(path, p))

/** The Studio sign-in address that returns to `here` (a path with its query) afterwards. */
export function studioSignInHref(here: string): string {
  return here && here !== "/studio" ? `${STUDIO_SIGN_IN_PATH}?next=${encodeURIComponent(here)}` : STUDIO_SIGN_IN_PATH
}

/**
 * Where a Studio page request must go instead, or null to serve it. `search` is the request's
 * query string ("" or "?a=b"), kept in the return address.
 */
export function studioGateRedirect(input: { path: string; search: string; seedDemo: boolean; hasBrandCookie: boolean }): string | null {
  if (input.seedDemo || !isStudioPath(input.path) || isPublicStudioPath(input.path) || input.hasBrandCookie) return null
  return studioSignInHref(`${input.path}${input.search}`)
}

/**
 * The page to open after a Studio sign-in: ?next= only when it is a path on this origin inside
 * /studio (never an external URL, a protocol-relative "//host" or the sign-in page itself), else
 * /studio.
 */
export function safeStudioNext(raw: string | null | undefined): string {
  const fallback = "/studio"
  if (!raw || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback
  try {
    const base = "https://studio.invalid"
    const url = new URL(raw, base)
    if (url.origin !== base || !isStudioPath(url.pathname) || under(url.pathname, STUDIO_SIGN_IN_PATH)) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
