import { z } from "zod"
import { pageState } from "@/server/catalog/page-exists"
import { json, route } from "@/server/http/route"

const query = z.object({
  kind: z.enum(["drop", "product", "brand", "collection"]),
  key: z.string().min(1).max(200),
  sub: z.string().min(1).max(200).optional(),
})

/**
 * GET /api/pages/exists?kind=drop|product|brand|collection&key=&sub=: whether that public detail
 * page has anything to show ({ exists, opensSoon }). src/proxy.ts asks it before a page renders,
 * so an unknown address answers with a real 404 in production (the page's own notFound() comes
 * after the prerendered shell has already sent 200). `opensSoon` marks a product or storefront of
 * a founding brand that hasn't launched: the page shows "opens soon" (kept out of search), never
 * the piece itself. It says no more than the page itself does.
 */
export const GET = route({ rate: { key: "pages.exists", limit: 240, windowSec: 60 }, auth: "public", query, cache: "no-store" }, async ({ query: q }) => {
  const state = await pageState(q.kind, q.key, q.sub)
  return json({ exists: state !== "none", opensSoon: state === "opens-soon" })
})
