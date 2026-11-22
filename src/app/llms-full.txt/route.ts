import { connection } from "next/server"
import { llmsTxt } from "@/lib/seo/llms"
import { llmsInput } from "@/server/seo/catalog"
import { documentResponse, unavailable } from "@/server/seo/respond"

/** GET /llms-full.txt: llms.txt plus every live brand and each category with its product count, rebuilt at most hourly. */
export async function GET() {
  // Request time only, outside the try: the build must not catch (and log) the prerender bail-out.
  await connection()
  try {
    return documentResponse(llmsTxt(await llmsInput(), true), "text/plain; charset=utf-8", 3600)
  } catch (e) {
    return unavailable("llms-full.txt", e)
  }
}
