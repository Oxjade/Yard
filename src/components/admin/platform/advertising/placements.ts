import { campaignTypes, type CampaignType, type Placement } from "@/lib/data/ads"

/**
 * Slot rules for every sponsored placement. Sponsored items only ever take designated
 * positions, never replace an organic result and are always labelled "Sponsored". The
 * positions match where the marketplace renders them (withSponsoredSlots / SPONSORED_SLOTS).
 */
export type PlacementRule = {
  name: string
  surface: string
  /** 1-based positions a sponsored item may take. */
  positions: number[]
  /** Items in one view of the placement, for the slot diagram. */
  viewSize: number
  maxPerView: number
  organicFirst: string
  /** Additional rule shown under the slot diagram. */
  note: string
}

export const placementRules: Record<Placement, PlacementRule> = {
  "home-featured-brands": {
    name: "Featured brands on Discover",
    surface: "Discover",
    positions: [2, 4],
    viewSize: 4,
    maxPerView: 2,
    organicFirst: "Position 1 is always an editorial pick",
    note: "A brand that already has an organic slot is not shown again as sponsored.",
  },
  "home-spotlight": {
    name: "Discover hero spotlight",
    surface: "Discover",
    positions: [2],
    viewSize: 2,
    maxPerView: 1,
    organicFirst: "The main hero is editorial and never sold",
    note: "One spotlight tile beside the hero. Bookings never overlap.",
  },
  "explore-brands": {
    name: "Featured brands in the directory",
    surface: "Brands",
    positions: [3, 5],
    viewSize: 5,
    maxPerView: 2,
    organicFirst: "The lead card and position 2 are editors' picks",
    note: "Paying never buys an editors' pick; picks are chosen without seeing bookings.",
  },
  "category-grid": {
    name: "Category grid",
    surface: "Category pages",
    positions: [5, 14],
    viewSize: 24,
    maxPerView: 2,
    organicFirst: "Positions 1 to 4 are always organic",
    note: "One sponsored item per brand per page. Out of stock or off-filter items are backfilled organically.",
  },
  "search-results": {
    name: "Search results",
    surface: "Search",
    positions: [5, 14],
    viewSize: 24,
    maxPerView: 2,
    organicFirst: "Positions 1 to 4 are always organic",
    note: "Never shown on a search for a brand's own name.",
  },
  "drops-feature": {
    name: "Featured drop",
    surface: "Drops and Discover",
    positions: [1],
    viewSize: 4,
    maxPerView: 1,
    organicFirst: "Other upcoming drops keep their release order",
    note: "The featured drop leads the Drops calendar and the Discover countdown strip.",
  },
  "editorial-collection": {
    name: "Editorial collection sponsor",
    surface: "Collections",
    positions: [1],
    viewSize: 1,
    maxPerView: 1,
    organicFirst: "The edit is chosen independently of the sponsor",
    note: "The sponsor is named on the collection. Products in it are not changed.",
  },
}

export const placementOrder = Object.keys(placementRules) as Placement[]

/** Campaign types that are sold into a placement. */
export function typesFor(placement: Placement) {
  return (Object.keys(campaignTypes) as CampaignType[]).filter((t) => campaignTypes[t].placements.includes(placement))
}

/**
 * Campaign decisions over this budget (in cents) need a second admin, as the Sensitive actions
 * policy on /admin/security states. The review queue enforces it.
 */
export const SECOND_APPROVER_OVER_CENTS = 100_000
export const secondApproverLabel = `Budget over $${(SECOND_APPROVER_OVER_CENTS / 100).toLocaleString("en-US")}`
