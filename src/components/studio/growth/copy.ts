/**
 * Page copy for the Studio growth pages, kept in a plain module so each route's loading state
 * (a server component) renders the same header as the page.
 */

export const dropsDescription = "Limited releases with a countdown, and a Notify me button for followers."

export const promotionsDescription = "Discount codes shoppers type at checkout, and sales that apply on their own. You fund the discount; it comes off the item price."

export const advertisingDescription = "Fixed-price sponsored placements on Discover, Brands, categories, search and Drops. Paid placements are always labelled Sponsored and never replace organic results."

/**
 * Studio's catalogue (products, collections, drops, promotions) lives in the Studio store in
 * this build, while the marketplace reads the static sample catalogue. Said once per page.
 */
export const CATALOGUE_NOTE = "Saved in Studio. Shoppers see these once the catalogue backend is connected."

/** Promotions are recorded in Studio; checkout doesn't apply them yet. */
export const PROMOTIONS_NOTE = "Saved in Studio. Discounts apply at checkout once the catalogue backend is connected; until then shoppers pay full price."
