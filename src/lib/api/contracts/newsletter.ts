import { z } from "zod"
import { NEWSLETTER_AUDIENCES, NEWSLETTER_KINDS } from "./enums"
import { safeLine, safeText } from "./common"
import { NEWSLETTER_LIMITS, type NewsletterAudienceType, type NewsletterKind, type NewsletterRecipientStatus, type NewsletterStatus } from "../../newsletter"

/**
 * Admin › Newsletter (comms.newsletter). Plain zod, no server-only import, so the composer checks
 * with the server's rules.
 *   GET  /api/admin/newsletters                    → { items, counts }
 *   POST /api/admin/newsletters { kind? }          → { campaign } (a new draft)
 *   GET  /api/admin/newsletters/{id}               → { campaign }
 *   PATCH /api/admin/newsletters/{id} { revision, …fields } → { campaign } (autosave; drafts only)
 *   DELETE /api/admin/newsletters/{id}             → { ok } (drafts only)
 *   POST …/{id}/preview { …unsaved fields }        → { subject, html, text }
 *   POST …/{id}/test { idempotencyKey }            → { to, created }
 *   POST …/{id}/send { when, at?, expectedCount, idempotencyKey } → { campaign }
 *   POST …/{id}/cancel                             → { campaign }
 *   GET  …/{id}/recipients?status=&offset=         → { items, nextOffset }
 *   GET  /api/admin/newsletters/audience?kind=&type=&brandId=&country= → { count }
 *   GET  /api/admin/newsletters/brands?q=          → { brands }
 */

const L = NEWSLETTER_LIMITS
const key = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, { error: "Send an idempotency key of 8–80 letters, digits, - or _." })

/** The editable fields. Every one is optional in a PATCH (autosave sends what changed). */
export const newsletterFields = z.strictObject({
  name: safeLine({ max: L.name }),
  kind: z.enum(NEWSLETTER_KINDS),
  subject: safeLine({ max: L.subject }),
  preheader: safeLine({ max: L.preheader }),
  heading: safeLine({ max: L.heading }),
  body: safeText({ max: L.body }),
  greet: z.boolean(),
  heroMediaId: z
    .string()
    .regex(/^med_[\w-]{1,64}$/, { error: "That image isn't valid." })
    .nullable(),
  heroAlt: safeLine({ max: L.heroAlt }),
  buttonLabel: safeLine({ max: L.buttonLabel }),
  buttonUrl: safeLine({ max: L.buttonUrl }),
  audience: z.enum(NEWSLETTER_AUDIENCES),
  audienceBrandId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).nullable(),
  audienceCountry: z
    .string()
    .regex(/^[A-Z]{2}$/, { error: "Choose the country." })
    .nullable(),
})
export type NewsletterFields = z.infer<typeof newsletterFields>

export const newsletterPatchBody = newsletterFields.partial().extend({ revision: z.number().int().min(1) })
export type NewsletterPatchBody = z.infer<typeof newsletterPatchBody>
export const newsletterCreateBody = z.strictObject({ kind: z.enum(NEWSLETTER_KINDS).optional() })
export const newsletterPreviewBody = newsletterFields.partial()
export const newsletterTestBody = z.strictObject({ idempotencyKey: key })
export const newsletterSendBody = z.strictObject({
  when: z.enum(["now", "later"]),
  /** For "later": an ISO time at least 5 minutes and at most 60 days out. */
  at: z.string().datetime({ offset: true }).optional(),
  /** The count the admin saw on the confirm step. "Now" refuses if the audience changed since. */
  expectedCount: z.number().int().min(0),
  idempotencyKey: key,
})
export type NewsletterSendBody = z.infer<typeof newsletterSendBody>

export const newsletterAudienceQuery = z.object({
  kind: z.enum(NEWSLETTER_KINDS),
  type: z.enum(NEWSLETTER_AUDIENCES),
  brandId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
})
export const newsletterBrandsQuery = z.object({ q: z.string().max(80).default("") })
export const newsletterRecipientsQuery = z.object({
  status: z.enum(["all", "pending", "queued", "sent", "failed", "suppressed", "stub", "cancelled", "unsubscribed"]).default("all"),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

export type NewsletterCountsDto = { total: number; pending: number; queued: number; sent: number; failed: number; suppressed: number; stub: number; cancelled: number; unsubscribed: number }

export type NewsletterAudienceDto = { type: NewsletterAudienceType; label: string; brandId: string | null; brandName: string | null; country: string | null }

export type NewsletterSummaryDto = {
  id: string
  name: string
  subject: string
  kind: NewsletterKind
  status: NewsletterStatus
  audience: NewsletterAudienceDto
  scheduledFor: string | null
  startedAt: string | null
  finishedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  updatedBy: string | null
  sentBy: string | null
  counts: NewsletterCountsDto
}

export type NewsletterDetailDto = NewsletterSummaryDto & {
  revision: number
  preheader: string
  heading: string
  body: string
  greet: boolean
  hero: { mediaId: string; src: string } | null
  heroAlt: string
  buttonLabel: string
  buttonUrl: string
  /** What still stops it from being sent ({ field: message }); empty when ready. */
  problems: Record<string, string>
  /** Emails this campaign handed to the outbox (one per recipient, never more). */
  outboxRows: number
}

export type NewsletterListDto = { items: NewsletterSummaryDto[]; counts: Record<NewsletterStatus, number> }
export type NewsletterRecipientDto = { userId: string; name: string; email: string; status: NewsletterRecipientStatus; unsubscribed: boolean; sentAt: string | null; lastError: string | null }
export type NewsletterRecipientsDto = { items: NewsletterRecipientDto[]; nextOffset: number | null }
export type NewsletterPreviewDto = { subject: string; html: string; text: string }
export type NewsletterBrandDto = { id: string; name: string; handle: string; followers: number }
