import { connection, type NextRequest } from "next/server"
import { site } from "@/config/site"
import { feedPage, googleFeedXml } from "@/lib/seo/feed"
import { feedCatalogue } from "@/server/seo/catalog"
import { documentResponse, notFoundText, unavailable } from "@/server/seo/respond"

/**
 * GET /feeds/google.xml: the product feed for Google Merchant Center (RSS 2.0, g: namespace), one
 * item per sellable variant of every live product. Built at most every 30 minutes
 * (src/server/seo/catalog.ts); pages of 5,000 items with ?page=N past the first (atom:link next).
 */
export async function GET(request: NextRequest) {
  // Request time only, outside the try: the build must not catch (and log) the prerender bail-out.
  await connection()
  try {
    const feed = await feedCatalogue()
    const page = feedPage(feed.items, request.nextUrl.searchParams.get("page"))
    if (!page) return notFoundText()
    const xml = googleFeedXml(feed.base, page, { title: `${site.name} products`, description: site.description, generatedAt: feed.generatedAt })
    return documentResponse(xml, "application/rss+xml; charset=utf-8", 1800, { "X-Robots-Tag": "noindex" })
  } catch (e) {
    return unavailable("The product feed", e)
  }
}
