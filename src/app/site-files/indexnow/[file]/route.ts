import { connection } from "next/server"
import { siteFileBody } from "@/lib/seo/site-verification"
import { documentResponse, notFoundText } from "@/server/seo/respond"

/**
 * GET /<INDEXNOW_KEY>.txt (rewritten here by next.config.ts): the IndexNow key file, which proves
 * to Bing and the other engines that our submissions are ours. Answers only the configured key,
 * read per request; 404 for anything else and while INDEXNOW_KEY is unset.
 */
export async function GET(_req: Request, ctx: RouteContext<"/site-files/indexnow/[file]">) {
  await connection()
  const { file } = await ctx.params
  const body = siteFileBody("indexnow", file)
  return body ? documentResponse(body, "text/plain; charset=utf-8", 300) : notFoundText()
}
