import { connection } from "next/server"
import { siteFileBody } from "@/lib/seo/site-verification"
import { documentResponse, notFoundText } from "@/server/seo/respond"

/**
 * GET /googleXXXX.html (rewritten here by next.config.ts): Google Search Console's HTML-file
 * verification. Answers only the exact name in GOOGLE_SITE_VERIFICATION_FILE, read per request, so
 * setting it needs a restart, not a rebuild.
 */
export async function GET(_req: Request, ctx: RouteContext<"/site-files/google/[file]">) {
  await connection()
  const { file } = await ctx.params
  const body = siteFileBody("google", file)
  return body ? documentResponse(body, "text/html; charset=utf-8", 300) : notFoundText()
}
