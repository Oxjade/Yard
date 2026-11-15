import { z } from "zod"
import { BRAND_EMAIL_BODY_MAX, BRAND_EMAIL_PRESETS, BRAND_EMAIL_SUBJECT_MAX } from "@/lib/brand-emails"
import { safeLine, safeText } from "./common"

/**
 * Brand emails from Yard (src/lib/brand-emails.ts holds the copy and the reminder rules).
 * Admin: GET/POST /api/admin/brand-emails/{brandId} (brands.email), POST …/preview.
 * Studio: GET/PUT /api/studio/settings/emails (reminders on or off; owners and admins change it).
 * Plain zod, no server-only import, so the composer validates with the server's rules.
 */

export const brandEmailSendBody = z.strictObject({
  preset: z.enum(BRAND_EMAIL_PRESETS),
  subject: safeLine({ max: BRAND_EMAIL_SUBJECT_MAX })
    .transform((s) => s.trim())
    .pipe(z.string().min(3, { error: "Give it a subject line." })),
  body: safeText({ max: BRAND_EMAIL_BODY_MAX })
    .transform((s) => s.trim())
    .pipe(z.string().min(10, { error: "Write the message first: at least 10 characters." })),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, { error: "Send an idempotency key of 8–80 letters, digits, - or _." }),
})
export type BrandEmailSendBody = z.infer<typeof brandEmailSendBody>

export const brandEmailPreviewBody = brandEmailSendBody.omit({ idempotencyKey: true })

export const studioEmailSettingsBody = z.strictObject({ nudges: z.boolean() })

export type BrandEmailRecipientDto = { name: string | null; email: string; role: string }

export type BrandEmailHistoryItemDto = {
  id: string
  at: string
  /** The audit action (brand_email.sent, brand_email.draft_nudge, onboarding.rejected, …). */
  action: string
  label: string
  /** The subject an admin wrote (one-tap emails only). */
  subject: string | null
  preset: string | null
  /** Who sent it: an admin's name, or null for an automatic reminder. */
  by: string | null
  /** How many people it went to. */
  emailed: number
}

export type BrandEmailContextDto = {
  brand: { id: string; name: string; handle: string; founding: boolean; claimStatus: string }
  recipients: BrandEmailRecipientDto[]
  history: BrandEmailHistoryItemDto[]
  /** One-tap emails sent to this brand in the last 24 hours (a rolling window, not the calendar day), and the cap. */
  sentToday: number
  dailyLimit: number
  /** At the cap: when the oldest of those sends turns 24 hours old and a slot opens (ISO), else null. */
  nextSendAt: string | null
  /** Whether the brand gets reminder emails (its own setting in Studio). */
  nudges: boolean
}

export type BrandEmailSendResult = BrandEmailContextDto & { emailed: number; created: boolean }
export type BrandEmailPreviewDto = { subject: string; html: string; text: string }
export type StudioEmailSettingsDto = { nudges: boolean; canEdit: boolean }
