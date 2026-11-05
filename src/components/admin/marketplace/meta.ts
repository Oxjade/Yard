import type { BrandApplication, BrandReviewStatus, ModerationItem, PlatformUser } from "@/lib/data/admin"

/** Labels and badge tones for the marketplace management screens. Acid = needs a decision. */

type Tone = "neutral" | "info" | "attention" | "success" | "danger" | "muted"
type Meta = { label: string; tone: Tone }

export const brandStatusMeta: Record<BrandReviewStatus, Meta> = {
  pending_review: { label: "Pending review", tone: "attention" },
  verified: { label: "Verified", tone: "success" },
  restricted: { label: "Restricted", tone: "attention" },
  suspended: { label: "Suspended", tone: "danger" },
}

export const kycMeta: Record<BrandApplication["kyc"], Meta> = {
  not_started: { label: "Not started", tone: "muted" },
  submitted: { label: "In review", tone: "info" },
  verified: { label: "Verified", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
}

export const riskMeta: Record<BrandApplication["risk"], Meta> = {
  low: { label: "Low", tone: "muted" },
  medium: { label: "Medium", tone: "attention" },
  high: { label: "High", tone: "danger" },
}

export const userStatusMeta: Record<PlatformUser["status"], Meta> = {
  active: { label: "Active", tone: "success" },
  restricted: { label: "Restricted", tone: "attention" },
  suspended: { label: "Suspended", tone: "danger" },
}

export const moderationReasonMeta: Record<ModerationItem["reason"], Meta> = {
  counterfeit: { label: "Counterfeit", tone: "danger" },
  prohibited: { label: "Prohibited", tone: "danger" },
  misleading: { label: "Misleading", tone: "attention" },
  ip_complaint: { label: "IP complaint", tone: "info" },
  auto_flag: { label: "Auto-flag", tone: "muted" },
}

export const moderationStatusMeta: Record<ModerationItem["status"], Meta> = {
  open: { label: "Open", tone: "attention" },
  escalated: { label: "Escalated to legal", tone: "info" },
  removed: { label: "Removed", tone: "muted" },
  dismissed: { label: "Dismissed", tone: "muted" },
}

/** Moderation states a listing can carry on top of its own lifecycle status (see productStatusMeta). */
export const listingStateMeta: Record<"restricted" | "removed", Meta> = {
  restricted: { label: "Restricted", tone: "attention" },
  removed: { label: "Removed", tone: "muted" },
}
