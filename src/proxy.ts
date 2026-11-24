import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { seedDemoFrom } from "./server/demo-switch"
import { guardConfigFrom, guardRequest, TokenBuckets, type GuardConfig } from "./server/http/api-guard"
import { logRequest } from "./server/http/request-log"
import { countEvent } from "./server/monitoring/minutes"
import { BRAND_SESSION_COOKIES, studioGateRedirect } from "./lib/studio-gate"
import { cookieHints, pageAccess, type AdminAccess, type StudioAccess } from "./lib/access-gate"

/**
 * The global per-IP safety net for /api/* (src/server/http/api-guard.ts): YARD_RATE_API_PER_MIN
 * (default 300) requests a minute per client IP, and YARD_RATE_AUTH_PER_MIN (default 60) for
 * /api/auth/*, both ten times roomier by default in development (the acceptance kits); a declared JSON body over YARD_MAX_JSON_BODY_BYTES (default 1 MB) is refused before
 * it is read. Refusals use the app's error shape ({ error: { code, message } }) with Retry-After.
 * Not matched at all: /api/uploads (multipart, its own caps, and a proxy would buffer the body),
 * /api/webhooks/* (the provider signs the raw body) and /api/health (monitors). Image reads
 * (GET /api/media/*) pass the shared bucket and count against their own route limit instead.
 * Buckets live in this process (one server per deployment, by design); globalThis keeps them
 * across development reloads.
 */
type GuardState = { buckets: TokenBuckets; cfg: GuardConfig; sweep?: ReturnType<typeof setInterval> }
const G = globalThis as typeof globalThis & { __yardApiGuard?: GuardState }

function guardState(): GuardState {
  if (!G.__yardApiGuard) {
    const state: GuardState = { buckets: new TokenBuckets(), cfg: guardConfigFrom(process.env) }
    state.sweep = setInterval(() => state.buckets.sweep((k) => (k.startsWith("auth|") ? state.cfg.authPerMin : state.cfg.apiPerMin)), 60_000)
    state.sweep.unref?.()
    G.__yardApiGuard = state
  }
  return G.__yardApiGuard
}

function guardApi(request: NextRequest): NextResponse {
  const started = Date.now()
  const { buckets, cfg } = guardState()
  const path = request.nextUrl.pathname
  const verdict = guardRequest(buckets, cfg, {
    method: request.method,
    path,
    forwardedFor: request.headers.get("x-forwarded-for"),
    contentLength: request.headers.get("content-length"),
    contentType: request.headers.get("content-type"),
  })
  if (verdict.ok) return NextResponse.next()
  const id = randomBytes(6).toString("hex")
  const headers: Record<string, string> = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": id }
  if (verdict.status === 429) headers["Retry-After"] = String(verdict.retryAfter)
  const code = verdict.status === 429 ? "rate_limited" : "too_large"
  logRequest({ id, method: request.method, path, status: verdict.status, ms: Date.now() - started, by: "proxy" })
  countEvent(verdict.status === 429 ? "proxy.rate_limited" : "proxy.too_large")
  return NextResponse.json({ error: { code, message: verdict.message } }, { status: verdict.status, headers })
}

/**
 * Sample-data screens in production. These pages have only made-up data so far (Studio promotions
 * and advertising; Control Center advertising; the marketplace's stories and curated
 * collections): the features behind them don't exist yet. Studio Analytics and Customers read
 * real data (src/server/analytics) and are no longer gated. With the demo switch off (getEnv().seedDemo, read per request
 * here, never baked in at build), each address redirects to its "coming soon" page; demo and
 * development pass straight through, so those screens stay exactly as they are. A redirect rather
 * than a rewrite: the coming-soon pages are prerendered at their own address, and chrome that reads
 * the pathname (the phone tab bar, the sidebars) must see the same one on the server and the client.
 *
 * A proxy rather than a gate in each segment's layout: several of these routes must stay fully
 * static (ensureStatic = "navigation"), which forbids request-time work anywhere in the route.
 */
const GATED: [prefix: string, target: string][] = [
  ["/studio/campaigns", "/studio/coming-soon/promotions"],
  ["/studio/advertising", "/studio/coming-soon/advertising"],
  ["/admin/advertising", "/admin/coming-soon/advertising"],
  ["/stories", "/coming-soon/stories"],
  ["/collections", "/coming-soon/collections"],
]

/**
 * Public detail pages whose address may name nothing (§ Next streaming guide, "The HTTP
 * contract"). In production these routes are served from a prerendered shell whose status is
 * already 200, so the segment layout's notFound() can show the not-found page but can't make it
 * a 404. Here, before anything renders, the same check (src/server/catalog/page-exists.ts, asked
 * through GET /api/pages/exists) turns an unknown address into a real 404: a rewrite to an
 * address no route matches, which renders the root not-found page with status 404 (the URL in
 * the address bar is kept). Only full page loads are checked: client navigations and prefetches
 * (RSC requests) read the segment's own not-found page, and their status isn't what a browser,
 * a crawler or a monitor sees. If the check can't answer, the page renders as before.
 */
type PageCheck = { kind: "drop" | "product" | "brand" | "collection"; key: string; sub?: string }

function pageCheck(path: string): PageCheck | null {
  const parts = path.split("/").filter(Boolean)
  let decoded: string[]
  try {
    decoded = parts.map((p) => decodeURIComponent(p))
  } catch {
    return null
  }
  const [root, key, ...rest] = decoded
  if (!key) return null
  if (root === "drops" && rest.length === 0) return { kind: "drop", key }
  if (root === "products" && rest.length === 0) return { kind: "product", key }
  if (root === "brands" && rest.length === 0) return { kind: "brand", key }
  if (root === "brands" && rest.length === 2 && rest[0] === "collections") return { kind: "collection", key, sub: rest[1] }
  return null
}

const NOT_FOUND_PATH = "/--not-found"

async function checkPage(request: NextRequest, check: PageCheck): Promise<NextResponse> {
  const method = request.method.toUpperCase()
  const rsc = request.headers.has("rsc") || request.headers.has("next-router-prefetch")
  if ((method !== "GET" && method !== "HEAD") || rsc) return NextResponse.next()
  // This server's own address (set by next start and next dev); the request's origin otherwise.
  const origin = process.env.__NEXT_PRIVATE_ORIGIN || request.nextUrl.origin
  const url = new URL("/api/pages/exists", origin)
  url.searchParams.set("kind", check.kind)
  url.searchParams.set("key", check.key)
  if (check.sub) url.searchParams.set("sub", check.sub)
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) })
    if (!res.ok) return NextResponse.next()
    const body = (await res.json()) as { exists?: unknown; opensSoon?: unknown }
    // A founding brand's piece or storefront before launch: the page answers "opens soon" (200,
    // like the other hidden-but-known pages), never indexed.
    if (body.exists !== false && body.opensSoon === true) {
      const next = NextResponse.next()
      next.headers.set("X-Robots-Tag", "noindex, nofollow")
      return next
    }
    if (body.exists !== false) return NextResponse.next()
  } catch {
    return NextResponse.next()
  }
  const target = request.nextUrl.clone()
  target.pathname = NOT_FOUND_PATH
  target.search = ""
  return NextResponse.rewrite(target)
}

/**
 * The Control Center, Brand Studio and the shopper's own pages in production (src/lib/access-gate.ts
 * has the whole matrix). The cookie check runs here for free; when a page needs more than a cookie
 * (a real admin whose role holds the section; a shopper who belongs to a brand) the proxy asks
 * GET /api/pages/access with the visitor's cookies, which reads the session through the DAL. A
 * session renewed by that read (rotation) hands its new cookie on to the visitor's response.
 */
async function askAccess<T>(request: NextRequest, params: Record<string, string>): Promise<{ body: T | null; setCookies: string[] }> {
  const origin = process.env.__NEXT_PRIVATE_ORIGIN || request.nextUrl.origin
  const url = new URL("/api/pages/access", origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  try {
    const res = await fetch(url, { cache: "no-store", headers: { cookie: request.headers.get("cookie") ?? "" }, signal: AbortSignal.timeout(5000) })
    const setCookies = res.headers.getSetCookie?.() ?? []
    return { body: res.ok ? ((await res.json()) as T) : null, setCookies }
  } catch {
    return { body: null, setCookies: [] }
  }
}

function redirectTo(request: NextRequest, target: string, setCookies: string[] = []) {
  const url = request.nextUrl.clone()
  const q = target.indexOf("?")
  url.pathname = q < 0 ? target : target.slice(0, q)
  url.search = q < 0 ? "" : target.slice(q)
  const res = NextResponse.redirect(url, 307)
  res.headers.set("Cache-Control", "no-store")
  for (const c of setCookies) res.headers.append("Set-Cookie", c)
  return res
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  if (path.startsWith("/api/")) return guardApi(request)
  const check = pageCheck(path)
  if (check) return checkPage(request, check)
  if (seedDemoFrom(process.env)) return NextResponse.next()
  // Brand Studio needs a brand session in production (src/lib/studio-gate.ts): signed out, the
  // page is never served; the visitor goes to the Studio sign-in and comes back here afterwards.
  const signIn = studioGateRedirect({ path, search: request.nextUrl.search, seedDemo: false, hasBrandCookie: BRAND_SESSION_COOKIES.some((c) => !!request.cookies.get(c)?.value) })
  // The Control Center, a shopper's way into Studio and the shopper's own pages (src/lib/access-gate.ts).
  const hints = cookieHints((c) => !!request.cookies.get(c)?.value)
  let renewed: string[] = []
  const ask = async <T,>(params: Record<string, string>) => {
    const { body, setCookies } = await askAccess<T>(request, params)
    renewed = setCookies
    return body
  }
  const access = await pageAccess({
    path,
    search: request.nextUrl.search,
    cookies: hints,
    studioSignIn: signIn,
    ask: { admin: (p) => ask<AdminAccess>({ area: "admin", path: p }), studio: () => ask<StudioAccess>({ area: "studio" }) },
  })
  if (access.kind === "redirect") return redirectTo(request, access.to, renewed)
  if (access.kind === "rewrite") {
    const url = request.nextUrl.clone()
    url.pathname = access.to
    url.search = ""
    const res = NextResponse.rewrite(url)
    res.headers.set("Cache-Control", "no-store")
    for (const c of renewed) res.headers.append("Set-Cookie", c)
    return res
  }
  if (signIn) {
    const url = request.nextUrl.clone()
    const q = signIn.indexOf("?")
    url.pathname = q < 0 ? signIn : signIn.slice(0, q)
    url.search = q < 0 ? "" : signIn.slice(q)
    const res = NextResponse.redirect(url, 307)
    res.headers.set("Cache-Control", "no-store")
    return res
  }
  const hit = GATED.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  if (!hit) {
    const next = NextResponse.next()
    for (const c of renewed) next.headers.append("Set-Cookie", c)
    return next
  }
  const url = request.nextUrl.clone()
  url.pathname = hit[1]
  url.search = ""
  const out = NextResponse.redirect(url, 307)
  for (const c of renewed) out.headers.append("Set-Cookie", c)
  return out
}

export const config = {
  matcher: [
    // Every Studio page: the sign-in gate (src/lib/studio-gate.ts) runs before GATED.
    "/studio",
    "/studio/:path*",
    "/studio/campaigns/:path*",
    "/studio/advertising/:path*",
    "/admin/advertising/:path*",
    // The Control Center and the shopper's own pages (src/lib/access-gate.ts).
    "/admin",
    "/admin/:path*",
    "/you",
    "/you/:path*",
    "/inbox",
    "/inbox/:path*",
    "/notifications",
    "/notifications/:path*",
    "/wishlist",
    "/wishlist/:path*",
    "/following",
    "/following/:path*",
    "/checkout",
    "/checkout/:path*",
    "/stories/:path*",
    "/collections/:path*",
    "/drops/:slug",
    "/products/:slug",
    "/brands/:handle",
    "/brands/:handle/collections/:collection",
    // Every API route except uploads, webhooks and the health check (see guardApi).
    "/api/((?!uploads(?:/|$)|webhooks/|health(?:/|$)).*)",
  ],
}
