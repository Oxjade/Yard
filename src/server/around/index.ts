import "server-only"

/**
 * Around contract (§1.8; cluster A). Other modules call `around.invalidate()` after a moderation
 * or brand-status change, inside or outside their transaction: it only drops the in-process
 * public lists, so it never queries and never throws.
 */
export const IMPL: string = "A-2026-11-06"

export { invalidate } from "./cache"
export { publicPlaces, publicEvents, publicPlaceWhere } from "./public"
export { listPlaces, placeDetail, brandBadge, onlineBrands } from "./reads"

/** Around has no scheduled jobs: pop-ups and events leave the public reads the moment they end. */
export const jobs = {}
