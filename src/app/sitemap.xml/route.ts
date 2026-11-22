import { connection } from "next/server"
import { absoluteUrl, publicOrigin } from "@/lib/seo/url"
import { newest, sitemapIndexXml, sitemapPart, sitemapParts, urlsetXml } from "@/lib/seo/sitemap"
import { sitemapEntries } from "@/server/seo/catalog"
import { documentResponse, unavailable } from "@/server/seo/respond"

/**
 * GET /sitemap.xml: every public page with lastModified (src/server/seo/catalog.ts sitemapEntries,
 * rebuilt at most every 30 minutes). Up to 50,000 URLs it is the urlset itself; past that it is a
 * sitemap index of /sitemaps/<n>.xml. A route handler rather than sitemap.ts + generateSitemaps:
 * generateSitemaps serves /sitemap/<id>.xml with no index at /sitemap.xml, and its ids are fixed
 * when the build runs, which never reads the database.
 */
export async function GET() {
  // Request time only, outside the try: the build must not catch (and log) the prerender bail-out.
  await connection()
  try {
    const entries = await sitemapEntries()
    const parts = sitemapParts(entries.length)
    if (parts === 1) return documentResponse(urlsetXml(entries), "application/xml; charset=utf-8", 1800)
    const base = publicOrigin()
    const index = Array.from({ length: parts }, (_, n) => ({ url: absoluteUrl(base, `/sitemaps/${n}.xml`), lastModified: newest(sitemapPart(entries, n)) }))
    return documentResponse(sitemapIndexXml(index), "application/xml; charset=utf-8", 1800)
  } catch (e) {
    return unavailable("The sitemap", e)
  }
}
