import { connection } from "next/server"
import { sitemapPart, sitemapParts, urlsetXml } from "@/lib/seo/sitemap"
import { sitemapEntries } from "@/server/seo/catalog"
import { documentResponse, notFoundText, unavailable } from "@/server/seo/respond"

/** GET /sitemaps/<n>.xml: part n (from 0) of the sitemap index /sitemap.xml serves once Yard has over 50,000 public URLs. */
export async function GET(_request: Request, { params }: RouteContext<"/sitemaps/[part]">) {
  const { part } = await params
  const m = /^(\d{1,4})\.xml$/.exec(part)
  if (!m) return notFoundText()
  // Request time only, outside the try: the build must not catch (and log) the prerender bail-out.
  await connection()
  try {
    const entries = await sitemapEntries()
    const n = Number(m[1])
    if (n >= sitemapParts(entries.length)) return notFoundText()
    return documentResponse(urlsetXml(sitemapPart(entries, n)), "application/xml; charset=utf-8", 1800)
  } catch (e) {
    return unavailable("The sitemap", e)
  }
}
