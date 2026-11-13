import { cookies } from "next/headers"
import { getEnv } from "@/server/env"
import { countryOf } from "@/server/geo/country"
import { noContent, route } from "@/server/http/route"
import { hit } from "@/server/security/rate-limit"
import { recordVisit, utcDay } from "@/server/traffic"

/**
 * POST /api/visit: one marketplace page view, for admin Traffic by country. Sent with
 * navigator.sendBeacon after a page has been visible for a second. Stores only the visit's country
 * (looked up from the IP, which is never kept); a `yard_vd` cookie holding today's UTC date marks
 * the browser's first view of the day, which counts it as a visitor. Crawlers and anything past
 * 60 views a minute per IP are not counted.
 */
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor|curl|wget|python|go-http|java\//i
const COOKIE = "yard_vd"

export const POST = route({ auth: "public", csrf: "beacon", maxBody: 256 }, async ({ req, ip, ipHash }) => {
  const ua = req.headers.get("user-agent") ?? ""
  if (!ua || BOT.test(ua)) return noContent()
  if (!hit(ipHash ? `visit:ip:${ipHash}` : "visit:anon", ipHash ? 60 : 3000, 60).ok) return noContent()

  const env = getEnv()
  const devCountry = env.nodeEnv !== "production" ? req.headers.get("x-yard-dev-country") : null
  const country = devCountry && /^[A-Z]{2}$/.test(devCountry) ? devCountry : await countryOf(ip)

  const today = utcDay()
  const jar = await cookies()
  const newVisitor = jar.get(COOKIE)?.value !== today
  if (newVisitor) jar.set(COOKIE, today, { httpOnly: true, sameSite: "lax", path: "/", secure: env.cookieSecure, maxAge: 2 * 86_400 })
  recordVisit(country, newVisitor)
  return noContent()
})
