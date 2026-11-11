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

export function proxy(request: NextRequest) {
  if (seedDemoFrom(process.env)) return NextResponse.next()
  const path = request.nextUrl.pathname
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
  ],
}
