import { NextResponse, type NextRequest } from "next/server"
import { seedDemoFrom } from "./server/demo-switch"

/**
 * Sample-data screens in production. These pages have only made-up data so far (Studio analytics,
 * customers, promotions and advertising; Control Center advertising and health; the marketplace's
 * stories and curated collections). With the demo switch off (getEnv().seedDemo, read per request
 * here, never baked in at build), each address redirects to its "coming soon" page; demo and
 * development pass straight through, so those screens stay exactly as they are. A redirect rather
 * than a rewrite: the coming-soon pages are prerendered at their own address, and chrome that reads
 * the pathname (the phone tab bar, the sidebars) must see the same one on the server and the client.
 *
 * A proxy rather than a gate in each segment's layout: several of these routes must stay fully
 * static (ensureStatic = "navigation"), which forbids request-time work anywhere in the route.
 */
const GATED: [prefix: string, target: string][] = [
  ["/studio/analytics", "/studio/coming-soon/analytics"],
  ["/studio/customers", "/studio/coming-soon/customers"],
  ["/studio/campaigns", "/studio/coming-soon/promotions"],
  ["/studio/advertising", "/studio/coming-soon/advertising"],
  ["/admin/advertising", "/admin/coming-soon/advertising"],
  ["/admin/health", "/admin/coming-soon/health"],
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
    const body = (await res.json()) as { exists?: unknown }
    if (body.exists !== false) return NextResponse.next()
  } catch {
    return NextResponse.next()
  }
  const target = request.nextUrl.clone()
  target.pathname = NOT_FOUND_PATH
  target.search = ""
  return NextResponse.rewrite(target)
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const check = pageCheck(path)
  if (check) return checkPage(request, check)
  if (seedDemoFrom(process.env)) return NextResponse.next()
  const hit = GATED.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  if (!hit) return NextResponse.next()
  const url = request.nextUrl.clone()
  url.pathname = hit[1]
  url.search = ""
  return NextResponse.redirect(url, 307)
}

export const config = {
  matcher: [
    "/studio/analytics/:path*",
    "/studio/customers/:path*",
    "/studio/campaigns/:path*",
    "/studio/advertising/:path*",
    "/admin/advertising/:path*",
    "/admin/health/:path*",
    "/stories/:path*",
    "/collections/:path*",
    "/drops/:slug",
    "/products/:slug",
    "/brands/:handle",
    "/brands/:handle/collections/:collection",
  ],
}
