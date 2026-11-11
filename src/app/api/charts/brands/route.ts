import { z } from "zod"
import type { BrandRanksDto } from "@/lib/api/contracts/charts"
import { getBrandBest } from "@/server/charts"
import { route } from "@/server/http/route"

/**
 * GET /api/charts/brands?ids=b_a,b_b,…: the best weekly rank of up to 48 brands in one read, for
 * the rank badges on brand cards, storefronts and product pages (the same answer as
 * GET /api/charts/brand/{id} for each). A page of brand cards makes one request instead of one per
 * card, the boards behind it are memoised server-side, and the answer is publicly cacheable.
 *
 * Badges have their own budget (`charts.badge`), separate from `charts.read`, so browsing pages full
 * of brand cards can never use up the allowance the Charts page and GET /api/charts draw on.
 */
const BADGE_RATE = { key: "charts.badge", limit: 120, windowSec: 60, anonGlobal: 6000 } as const
// Sample ids (b_lagos_static) and server ids (newId: base36 time + base64url, so mixed case and "-").
const BRAND_ID = /^b_[A-Za-z0-9_-]{1,60}$/
const MAX_RANK_IDS = 48

const query = z.strictObject({
  ids: z
    .string()
    .max(MAX_RANK_IDS * 64)
    .transform((s) => [...new Set(s.split(",").map((v) => v.trim()).filter(Boolean))])
    .refine((ids) => ids.length >= 1 && ids.length <= MAX_RANK_IDS, { error: `Send between 1 and ${MAX_RANK_IDS} brand ids.` })
    .refine((ids) => ids.every((v) => BRAND_ID.test(v)), { error: "One of the brand ids isn't valid." }),
})

export const GET = route({ auth: "public", cache: { public: 300 }, rate: BADGE_RATE, query }, async ({ query }) => {
  const entries = await Promise.all(query.ids.map(async (id) => [id, await getBrandBest(id)] as const))
  const out: BrandRanksDto = { ranks: Object.fromEntries(entries) }
  return out
})
