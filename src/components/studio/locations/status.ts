import type { StudioPlaceStatus } from "@/lib/api/contracts/around"

type Tone = "neutral" | "info" | "attention" | "success" | "danger" | "muted"

/** Studio status badges for places and events (§6.4 Studio Locations). */
export const placeStatusMeta: Record<StudioPlaceStatus, { label: string; tone: Tone }> = {
  published: { label: "Published", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
  hidden: { label: "Hidden", tone: "muted" },
  in_review: { label: "In review", tone: "info" },
  ended: { label: "Ended", tone: "muted" },
  rejected: { label: "Rejected by Yard", tone: "danger" },
  removed: { label: "Removed by Yard", tone: "danger" },
}

export const locationsDescription = "Stores, showrooms, pop-ups and events shoppers can find on Yard Around. Only what you publish appears."
