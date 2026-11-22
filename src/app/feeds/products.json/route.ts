import { connection, type NextRequest } from "next/server"
import { site } from "@/config/site"
import { feedPage, productsJson } from "@/lib/seo/feed"
import { feedCatalogue } from "@/server/seo/catalog"
import { documentResponse, notFoundText, unavailable } from "@/server/seo/respond"

/** GET /feeds/products.json: the Google feed's items as plain JSON (other shopping and AI programs); same cache and paging. */
export async function GET(request: NextRequest) {
  // Request time only, outside the try: the build must not catch (and log) the prerender bail-out.
  await connection()
  try {
    const feed = await feedCatalogue()
    const page = feedPage(feed.items, request.nextUrl.searchParams.get("page"))
    if (!page) return notFoundText()
    const body = JSON.stringify(productsJson(feed.base, page, { title: `${site.name} products`, generatedAt: feed.generatedAt }))
    return documentResponse(body, "application/json; charset=utf-8", 1800, { "X-Robots-Tag": "noindex" })
  } catch (e) {
    return unavailable("The product feed", e)
  }
}
