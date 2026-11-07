import { getBrandBest } from "@/server/charts"
import { READ_RATE } from "@/server/charts/limit"
import { route } from "@/server/http/route"

/**
 * GET /api/charts/brand/{brandId}: the brand's best weekly rank (Top brands, Trending, Emerging,
 * then its City board; 20th or better), or `{ sample: true }` when it has none or isn't listed.
 */
export const GET = route({ auth: "public", cache: { public: 300 }, rate: READ_RATE }, async ({ params }) => {
  const id = params.brandId ?? ""
  if (!/^b_[a-z0-9_]{1,60}$/.test(id)) return { sample: true }
  return getBrandBest(id)
})
