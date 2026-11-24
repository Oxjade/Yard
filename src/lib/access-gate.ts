/**
 * Who may open the Control Center, Brand Studio and the shopper's own pages in production
 * (src/proxy.ts). No imports, so the proxy (bundled apart from the app) and `tsx --test` share it.
 *
 * Two steps, so the common case costs nothing:
 *  1. `accessGate` looks only at which session cookies the request carries. Without the right one
 *     the visitor is redirected before anything renders (no database work, static routes stay
 *     static).
 *  2. When the cookie is there but the page needs more than "signed in" (the Control Center: is this
 *     really an admin, and may their role open this section; Studio: does this shopper belong to any
 *     brand), it answers `verify` and the proxy asks GET /api/pages/access, which reads the session
 *     through the DAL. `adminVerdict` / `studioVerdict` turn that answer into the redirect.
 *
 * The demo and development never reach this (the proxy returns first), and every API checks the
 * session again on its own: this only decides which page a browser gets.
 *
 * | visitor                      | /admin/**                  | /studio/** (not sign-in, onboarding) | /you, /inbox, … |
 * |------------------------------|----------------------------|--------------------------------------|-----------------|
 * | signed out                   | /admin/sign-in?next=…      | /studio/sign-in?next=… (studio-gate)  | /sign-in?next=… |
 * | shopper, no brand            | /                          | /sell                                | page            |
 * | shopper who is a brand member| /                          | /studio/sign-in?next=…                | page            |
 * | brand session                | /                          | page                                 | page (shopper)  |
 * | admin, section not in role   | "no access" page (rewrite) | —                                    | —               |
 * | admin                        | page                       | —                                    | —               |
 */

export const ADMIN_SIGN_IN_PATH = "/admin/sign-in"
export const ADMIN_NO_ACCESS_PATH = "/admin/no-access"
export const SHOPPER_SIGN_IN_PATH = "/sign-in"
export const SELL_PATH = "/sell"
export const LANDING_PATH = "/"

/** Session cookies (server/auth/session.ts sessionPolicy), plain or __Host- when Secure. */
export const SHOPPER_SESSION_COOKIES = ["yard_s", "__Host-yard_s"] as const
export const BRAND_COOKIES = ["yard_b", "__Host-yard_b"] as const
export const ADMIN_SESSION_COOKIES = ["yard_a", "__Host-yard_a"] as const

/**
 * The shopper's own pages: signed out, the visitor goes to the sign-in page and comes back.
 * The bag is not here: a guest may fill a cart; checkout asks to sign in.
 */
export const ACCOUNT_PATHS = ["/you", "/inbox", "/notifications", "/wishlist", "/following", "/checkout"] as const

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

export const isAdminPath = (path: string) => under(path, "/admin")
export const isAdminSignInPath = (path: string) => under(path, ADMIN_SIGN_IN_PATH)
export const isAccountPath = (path: string) => ACCOUNT_PATHS.some((p) => under(path, p))

export type CookieHints = { shopper: boolean; brand: boolean; admin: boolean }

/** Which session cookies a request carries (any non-empty value; verified later, if at all). */
export function cookieHints(has: (name: string) => boolean): CookieHints {
  return {
    shopper: SHOPPER_SESSION_COOKIES.some(has),
    brand: BRAND_COOKIES.some(has),
    admin: ADMIN_SESSION_COOKIES.some(has),
  }
}

export type GateDecision = { kind: "pass" } | { kind: "redirect"; to: string } | { kind: "verify"; area: "admin" | "studio" }

const withNext = (signIn: string, here: string, home: string) => (here && here !== home ? `${signIn}?next=${encodeURIComponent(here)}` : signIn)

export const adminSignInHref = (here: string) => withNext(ADMIN_SIGN_IN_PATH, here, "/admin")
export const shopperSignInHref = (here: string) => withNext(SHOPPER_SIGN_IN_PATH, here, "")

/**
 * The cookie-only step. Studio requests without a brand cookie are the studio gate's
 * (src/lib/studio-gate.ts) when signed out; with a shopper cookie they need the server's answer
 * (member of a brand, or not). `search` is "" or "?a=b" and is kept in the return address.
 */
export function accessGate(input: { path: string; search: string; cookies: CookieHints }): GateDecision {
  const { path, search, cookies } = input
  const here = `${path}${search}`
  if (isAdminPath(path)) {
    if (isAdminSignInPath(path)) return { kind: "pass" }
    if (cookies.admin) return { kind: "verify", area: "admin" }
    // Signed in somewhere else (a shopper or a brand) but not to the Control Center: the landing page.
    if (cookies.shopper || cookies.brand) return { kind: "redirect", to: LANDING_PATH }
    return { kind: "redirect", to: adminSignInHref(here) }
  }
  if (isAccountPath(path)) return cookies.shopper ? { kind: "pass" } : { kind: "redirect", to: shopperSignInHref(here) }
  return { kind: "pass" }
}

/** GET /api/pages/access?area=admin: the server's view of this request's sessions. */
export type AdminAccess = { admin: boolean; permitted: boolean; signedIn: boolean }

/**
 * After verification: an admin whose role holds the section opens it; an admin without it gets
 * the calm "no access" page in place (a rewrite, so the address stays); anyone else is sent to the
 * landing page when they are signed in as a shopper or a brand, or to the admin sign-in.
 * `access` null means the server couldn't answer: fail closed, to the sign-in page.
 */
export function adminVerdict(input: { path: string; search: string; access: AdminAccess | null }): { kind: "pass" } | { kind: "redirect"; to: string } | { kind: "rewrite"; to: string } {
  const { path, search, access } = input
  if (access?.admin) return access.permitted ? { kind: "pass" } : { kind: "rewrite", to: ADMIN_NO_ACCESS_PATH }
  if (access?.signedIn) return { kind: "redirect", to: LANDING_PATH }
  return { kind: "redirect", to: adminSignInHref(`${path}${search}`) }
}

/** GET /api/pages/access?area=studio: whether the shopper session is live and belongs to any brand. */
export type StudioAccess = { shopper: boolean; brandMember: boolean }

/**
 * A Studio page without a brand session, but with a shopper cookie: a member of a brand signs in to
 * Studio (and comes back); a shopper with no brand has nothing in Studio and goes to the Sell page,
 * where applying starts. `access` null (no answer): the Studio sign-in, as when signed out.
 */
export function studioVerdict(input: { access: StudioAccess | null; signInHref: string }): { kind: "redirect"; to: string } {
  const { access, signInHref } = input
  if (access?.shopper && !access.brandMember) return { kind: "redirect", to: SELL_PATH }
  return { kind: "redirect", to: signInHref }
}

export type PageAccess = { kind: "pass" } | { kind: "redirect"; to: string } | { kind: "rewrite"; to: string }

/**
 * The whole production decision for one page request, as src/proxy.ts runs it (and the route
 * access matrix test drives it). `studioSignIn` is the studio gate's answer for this request
 * (src/lib/studio-gate.ts studioGateRedirect: the Studio sign-in address, or null). `ask` reaches
 * GET /api/pages/access and is only called when the cookies can't decide. "pass" with a
 * `studioSignIn` still set means: signed out of everything, the studio gate redirects.
 */
export async function pageAccess(input: {
  path: string
  search: string
  cookies: CookieHints
  studioSignIn: string | null
  ask: { admin: (path: string) => Promise<AdminAccess | null>; studio: () => Promise<StudioAccess | null> }
}): Promise<PageAccess> {
  const { path, search, cookies, studioSignIn, ask } = input
  if (studioSignIn) return cookies.shopper ? studioVerdict({ access: await ask.studio(), signInHref: studioSignIn }) : { kind: "pass" }
  const gate = accessGate({ path, search, cookies })
  if (gate.kind !== "verify") return gate
  return adminVerdict({ path, search, access: await ask.admin(path) })
}
