import { site } from "@/config/site"

/**
 * The commission in force at a moment: 0 during the launch offer (before site.launchFreeUntil),
 * then site.commissionRate. Brand-specific overrides set by admin are applied on the server only.
 */
const FREE_UNTIL = Date.parse(site.launchFreeUntil)

export const inLaunchOffer = (at: Date | number = Date.now()) => (typeof at === "number" ? at : at.getTime()) < FREE_UNTIL

export const commissionRateAt = (at: Date | number = Date.now()) => (inLaunchOffer(at) ? 0 : site.commissionRate)

/** "3.5%" — at most one decimal, no trailing ".0". */
export const formatRate = (rate: number) => `${Math.round(rate * 1000) / 10}%`

/** The launch offer's end as "12 February 2027" (UTC, so server and browser agree). */
export const launchOfferEnds = new Date(FREE_UNTIL).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })

/** Plain-words commission for brands: "0% until 12 February 2027, then 3.5%" or "3.5%". */
export const commissionLabel = (at: Date | number = Date.now()) =>
  inLaunchOffer(at) ? `0% until ${launchOfferEnds}, then ${formatRate(site.commissionRate)}` : formatRate(site.commissionRate)
