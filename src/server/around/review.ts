import "server-only"
import { rule } from "../http/errors"

/**
 * Review rules for places and events (§6.4). One function decides the moderation status of a
 * write, so places and events follow the same rules:
 * - an unverified brand's publish, and any material edit while published, goes to review;
 * - a row Yard decided on before (`reviewed_at` set, copied by Duplicate) goes back to review when
 *   it is published again or edited materially while published, even for a verified brand;
 * - rejected and removed rows are locked: delete only;
 * - otherwise a verified brand publishes straight away (`approved`).
 */

export type Moderation = "approved" | "pending_review" | "rejected" | "removed"
export type Visibility = "draft" | "published" | "hidden"
export type Outcome = "published" | "submitted" | "resubmitted" | "saved" | "hidden" | "draft"

export type ReviewInput = {
  subject: "place" | "event"
  brandVerified: boolean
  /** The row before the write (null for a create). */
  prev: { visibility: Visibility; moderationStatus: Moderation; moderationReason: string | null; reviewedAt: Date | null } | null
  /** reviewed_at the row carries (a duplicate copies its source's). */
  reviewedAt: Date | null
  nextVisibility: Visibility
  material: boolean
}

export function assertUnlocked(subject: "place" | "event", row: { moderationStatus: string; moderationReason: string | null }) {
  const word = subject === "place" ? "place" : "event"
  if (row.moderationStatus === "removed") throw rule(`Yard removed this ${word}. You can delete it.`)
  if (row.moderationStatus === "rejected") {
    const reason = row.moderationReason?.replace(/\.$/, "")
    throw rule(`Yard rejected this ${word}${reason ? `: ${reason}` : ""}. Duplicate it to submit a corrected version.`)
  }
}

export function decide(input: ReviewInput): { moderationStatus: Moderation; outcome: Outcome } {
  const { prev, nextVisibility, material, brandVerified } = input
  if (prev) assertUnlocked(input.subject, prev)
  const reviewed = !!input.reviewedAt
  const wasPublished = prev?.visibility === "published"
  const prevStatus = prev?.moderationStatus ?? "approved"

  if (nextVisibility !== "published") {
    // Taking a place off Around withdraws it from review; publishing again re-applies the rules.
    return { moderationStatus: "approved", outcome: nextVisibility === "hidden" ? "hidden" : "draft" }
  }
  if (!wasPublished) {
    if (!brandVerified) return { moderationStatus: "pending_review", outcome: "submitted" }
    if (reviewed) return { moderationStatus: "pending_review", outcome: "resubmitted" }
    return { moderationStatus: "approved", outcome: "published" }
  }
  // Staying published.
  if (material) {
    if (!brandVerified) return { moderationStatus: "pending_review", outcome: "submitted" }
    if (reviewed) return { moderationStatus: "pending_review", outcome: "resubmitted" }
  }
  if (prevStatus === "pending_review") return { moderationStatus: "pending_review", outcome: brandVerified ? "resubmitted" : "submitted" }
  return { moderationStatus: "approved", outcome: material ? "published" : "saved" }
}

/**
 * Fields whose change is "material" (§6.4): what a reviewer looked at. Shopper-visible free text
 * (description, the hours note, an event's description) counts too, so an approved place can't
 * swap in a phone number or off-platform payment instructions without going back to review.
 */
export const PLACE_MATERIAL = ["name", "description", "addressLine", "city", "citySlug", "neighbourhood", "lat", "lng", "images", "kind", "startsAt", "endsAt", "hoursNote"] as const
export const EVENT_MATERIAL = ["kind", "title", "description", "startsAt", "endsAt", "image", "dropId", "promoText"] as const

/** Every field an edit can change, named (never valued) in the `location.updated` audit row. */
export const PLACE_AUDIT_FIELDS = [...PLACE_MATERIAL, "pinPrecision", "hours", "byAppointment", "featuredProductIds"] as const
export const EVENT_AUDIT_FIELDS = [...EVENT_MATERIAL, "productIds"] as const

const norm = (v: unknown): unknown => {
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(norm)
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
  return v ?? null
}

export function changedKeys<T extends Record<string, unknown>>(before: T, after: T, keys: readonly string[]) {
  return keys.filter((k) => JSON.stringify(norm(before[k])) !== JSON.stringify(norm(after[k])))
}

export function changed<T extends Record<string, unknown>>(before: T, after: T, keys: readonly string[]) {
  return changedKeys(before, after, keys).length > 0
}
