import { brandBadge } from "@/server/around"
import { json, route } from "@/server/http/route"

/**
 * GET /api/around/brand/{brandId} (§6.4): what N's PlaceBadge needs, through publicPlaces().
 * Cached for up to 5 minutes, never past the end of the pop-up or event it names.
 */
export const GET = route({ auth: "public", rate: { key: "around.read", limit: 120, windowSec: 60, anonGlobal: 6000 } }, async ({ params }) => {
  const brandId = params.brandId ?? ""
  if (!/^b_[a-z0-9_]{1,60}$/.test(brandId)) return json({ count: 0 }, 200, { "Cache-Control": "public, max-age=300" })
  const { badge, maxAge } = await brandBadge(brandId)
  return json(badge, 200, { "Cache-Control": `public, max-age=${maxAge}` })
})
