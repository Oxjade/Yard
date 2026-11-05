import { campaigns } from "@/lib/data/ads"
import type { Drop } from "@/lib/data/types"

/**
 * Drops booked into the paid "drops-feature" slot on /drops. Read from the ad campaigns so a
 * paid placement is always traceable to a booking, and labelled wherever it is shown.
 */
export const featuredDropIds = new Set(
  campaigns
    .filter((c) => c.type === "sponsored-drop" && c.status === "active" && c.placements.includes("drops-feature"))
    .flatMap((c) => c.targetIds),
)

/** A drop is a paid placement when a campaign books it or the drop record says so. */
export const isSponsoredDrop = (d: Drop) => featuredDropIds.has(d.id) || !!d.sponsored

/** Short, plain names for the release types, for chips and fact lists. */
export const accessName: Record<Drop["access"], string> = {
  "first-come": "First come",
  draw: "Draw",
  "early-access": "Early access",
}

/** What each release type means for the shopper, in one sentence. */
export const accessRule: Record<Drop["access"], string> = {
  "first-come": "Opens to everyone at release. Pieces go to whoever checks out first.",
  draw: "Enter before release. Winners are picked at random and only winners pay.",
  "early-access": "Followers of the brand get the first window, then it opens to everyone.",
}

export const limitText = (d: Drop) => `Limit ${d.limitPerCustomer} per customer`

/** Truthful scarcity: the run size, and how it went for past drops. */
export function runText(d: Drop) {
  const sold = d.totalUnits - d.unitsLeft
  if (d.unitsLeft <= 0) return `All ${d.totalUnits} sold`
  if (d.releaseOffsetHours > 0) return `${d.totalUnits} pieces in the run`
  return `${sold} of ${d.totalUnits} sold`
}

/** "10 days ago": release offsets are relative to the demo load, so this is safe on the server. */
export function releasedAgo(d: Drop) {
  const hours = -d.releaseOffsetHours
  if (hours < 24) return `${Math.max(1, Math.round(hours))} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}
