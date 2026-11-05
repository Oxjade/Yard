import type { CurrencyCode } from "@/config/markets"

/**
 * Advertising. Fixed prices to start (blueprint §10.6); admins can change them.
 * Sponsored placements occupy designated slots and are always labelled.
 */

export type CampaignType =
  | "sponsored-brand"
  | "sponsored-product"
  | "sponsored-drop"
  | "homepage-spotlight"
  | "category-promotion"
  | "editorial-sponsorship"

export type Placement = "home-featured-brands" | "home-spotlight" | "explore-brands" | "category-grid" | "search-results" | "drops-feature" | "editorial-collection"

export const campaignTypes: Record<CampaignType, { name: string; description: string; unit: "day" | "campaign"; priceUsd: number; placements: Placement[] }> = {
  "sponsored-brand": { name: "Sponsored brand", description: "Your brand in featured-brand slots on Discover and Brands.", unit: "day", priceUsd: 1500, placements: ["home-featured-brands", "explore-brands"] },
  "sponsored-product": { name: "Sponsored product", description: "A product in a fixed sponsored slot in its category and in search.", unit: "day", priceUsd: 500, placements: ["category-grid", "search-results"] },
  "sponsored-drop": { name: "Sponsored drop", description: "Your drop featured on Drops and the Discover countdown strip.", unit: "campaign", priceUsd: 3000, placements: ["drops-feature"] },
  "homepage-spotlight": { name: "Homepage spotlight", description: "The secondary campaign tile on the Discover hero.", unit: "day", priceUsd: 5000, placements: ["home-spotlight"] },
  "category-promotion": { name: "Category promotion", description: "A banner slot at the top of one category.", unit: "day", priceUsd: 1200, placements: ["category-grid"] },
  "editorial-sponsorship": { name: "Editorial sponsorship", description: "Sponsor a curated collection. The edit stays independent; your name appears as sponsor.", unit: "campaign", priceUsd: 25000, placements: ["editorial-collection"] },
}

export type CampaignStatus = "draft" | "in_review" | "scheduled" | "active" | "paused" | "completed" | "rejected"

export type Campaign = {
  id: string
  brandId: string
  type: CampaignType
  name: string
  status: CampaignStatus
  targetIds: string[]
  audience: { categories: string[]; countries: string[] }
  placements: Placement[]
  startDaysFromToday: number
  days: number
  budget: number
  currency: CurrencyCode
  results: { impressions: number; reach: number; clicks: number; productViews: number; addToCarts: number; purchases: number; revenue: number }
  rejectionReason?: string
}

export const campaigns: Campaign[] = [
  { id: "cmp_mo_brand", brandId: "b_mute_objects", type: "sponsored-brand", name: "Mute Objects — November", status: "active", targetIds: ["b_mute_objects"], audience: { categories: ["technology", "home-lifestyle"], countries: [] }, placements: ["home-featured-brands", "explore-brands"], startDaysFromToday: -6, days: 14, budget: 21000, currency: "USD", results: { impressions: 48210, reach: 31090, clicks: 1342, productViews: 2210, addToCarts: 188, purchases: 41, revenue: 1_410_000 } },
  { id: "cmp_vu_brand", brandId: "b_velvet_underpass", type: "sponsored-brand", name: "Velvet Underpass — bags", status: "active", targetIds: ["b_velvet_underpass"], audience: { categories: ["accessories"], countries: ["GB", "FR", "DE", "US"] }, placements: ["home-featured-brands", "explore-brands"], startDaysFromToday: -2, days: 7, budget: 10500, currency: "USD", results: { impressions: 12880, reach: 9930, clicks: 402, productViews: 610, addToCarts: 51, purchases: 9, revenue: 247_000 } },
  { id: "cmp_nf_drop", brandId: "b_null_form", type: "sponsored-drop", name: "NF-04 Prism release", status: "active", targetIds: ["d_nf_04"], audience: { categories: ["sneakers", "streetwear"], countries: [] }, placements: ["drops-feature"], startDaysFromToday: -3, days: 4, budget: 3000, currency: "USD", results: { impressions: 30400, reach: 22800, clicks: 2980, productViews: 3310, addToCarts: 0, purchases: 0, revenue: 0 } },
  { id: "cmp_nf_product", brandId: "b_null_form", type: "sponsored-product", name: "NF-05 Trail Boot in Sneakers", status: "active", targetIds: ["p_nf_05_trail_boot"], audience: { categories: ["sneakers"], countries: [] }, placements: ["category-grid", "search-results"], startDaysFromToday: -4, days: 10, budget: 5000, currency: "USD", results: { impressions: 9020, reach: 7210, clicks: 288, productViews: 288, addToCarts: 22, purchases: 6, revenue: 115_000 } },
  { id: "cmp_mo_product", brandId: "b_mute_objects", type: "sponsored-product", name: "Bookshelf speaker in Technology", status: "active", targetIds: ["p_bookshelf_speaker"], audience: { categories: ["technology"], countries: [] }, placements: ["category-grid", "search-results"], startDaysFromToday: -1, days: 10, budget: 5000, currency: "USD", results: { impressions: 2104, reach: 1880, clicks: 61, productViews: 61, addToCarts: 4, purchases: 1, revenue: 23_900 } },
  { id: "cmp_mo_editorial", brandId: "b_mute_objects", type: "editorial-sponsorship", name: "After-dark objects", status: "active", targetIds: ["cc_after_dark"], audience: { categories: [], countries: [] }, placements: ["editorial-collection"], startDaysFromToday: -10, days: 30, budget: 25000, currency: "USD", results: { impressions: 15600, reach: 11200, clicks: 740, productViews: 1120, addToCarts: 96, purchases: 18, revenue: 512_000 } },
  { id: "cmp_ls_spot", brandId: "b_lagos_static", type: "homepage-spotlight", name: "Drop 07 spotlight", status: "in_review", targetIds: ["d_ls_third_mainland"], audience: { categories: ["streetwear"], countries: [] }, placements: ["home-spotlight"], startDaysFromToday: 1, days: 2, budget: 10000, currency: "USD", results: { impressions: 0, reach: 0, clicks: 0, productViews: 0, addToCarts: 0, purchases: 0, revenue: 0 } },
  { id: "cmp_ls_prod", brandId: "b_lagos_static", type: "sponsored-product", name: "Moto jacket in Streetwear", status: "completed", targetIds: ["p_static_moto_jacket"], audience: { categories: ["streetwear"], countries: ["NG", "GH", "GB"] }, placements: ["category-grid", "search-results"], startDaysFromToday: -30, days: 7, budget: 3500, currency: "USD", results: { impressions: 11340, reach: 8120, clicks: 356, productViews: 356, addToCarts: 31, purchases: 8, revenue: 68_000 } },
  { id: "cmp_gl_brand", brandId: "b_gridlock_supply", type: "sponsored-brand", name: "Gridlock — restock week", status: "rejected", targetIds: ["b_gridlock_supply"], audience: { categories: ["streetwear"], countries: ["US"] }, placements: ["home-featured-brands"], startDaysFromToday: 2, days: 5, budget: 7500, currency: "USD", results: { impressions: 0, reach: 0, clicks: 0, productViews: 0, addToCarts: 0, purchases: 0, revenue: 0 }, rejectionReason: "Creative uses a third-party logo. Replace the cover image and resubmit." },
]

/** Brands currently paying for featured-brand slots. */
export const sponsoredBrandIds = campaigns.filter((c) => c.type === "sponsored-brand" && c.status === "active").map((c) => c.brandId)
/** Products currently in sponsored category/search slots. */
export const sponsoredProductIds = campaigns.filter((c) => c.type === "sponsored-product" && c.status === "active").flatMap((c) => c.targetIds)

/** Attribution window used for "attributed purchases" (blueprint §10.8). */
export const ATTRIBUTION = { clickDays: 7, viewDays: 1, note: "A purchase is attributed when the shopper clicked the placement within 7 days, or saw it within 1 day and then opened the product. Purchases without either are organic." }

/**
 * Insert sponsored items into designated slots without replacing organic ones.
 * Positions are 0-based indexes in the final list; at most one sponsored item per slot.
 */
export function withSponsoredSlots<T>(organic: T[], sponsored: T[], positions: number[]): { item: T; sponsored: boolean }[] {
  const out = organic.map((item) => ({ item, sponsored: false }))
  positions.forEach((pos, i) => {
    const s = sponsored[i]
    if (s === undefined || pos > out.length) return
    out.splice(pos, 0, { item: s, sponsored: true })
  })
  return out
}
