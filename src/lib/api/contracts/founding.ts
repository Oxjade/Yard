import { z } from "zod"
import { countryCodes, currencyCodes } from "@/config/markets"
import { safeId, safeLine, safeText } from "@/lib/api/contracts/common"

/**
 * Founding brands (Yard sets up the first real brands, then each owner claims theirs). Plain zod
 * with no server-only import, so the admin UI and the /auth/claim page can validate inline with
 * the same rules the server applies. Strict bodies: an unknown field is a 400.
 */

/**
 * The seller agreement a claimant accepts. Bump the version when the text changes (the text
 * itself lives on /legal/seller-agreement and comes from the owner). Stored on the brand and the
 * claim invite with the time it was accepted.
 */
export const SELLER_AGREEMENT_VERSION = "2026-11-founding-v1"

/** How long a claim link works. */
export const CLAIM_LINK_DAYS = 7

/** Admin list status, derived on the server (never stored). */
export const FOUNDING_STATUSES = ["setting_up", "link_sent", "claimed", "live"] as const
export type FoundingStatus = (typeof FOUNDING_STATUSES)[number]

const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, { error: "Send an idempotency key of 8–80 letters, digits, - or _." })
const handle = z
  .string()
  .min(3, { error: "Use at least 3 characters." })
  .max(30, { error: "Use 30 characters or fewer." })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "Use lowercase letters, numbers and single hyphens." })
/** An Instagram / TikTok handle: no @, no URL. A leading @ is dropped. */
const social = (max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/^@/, ""))
    .pipe(z.string().regex(new RegExp(`^[A-Za-z0-9._]{1,${max}}$`), { error: `Enter the ${label} handle only, without @ or a link.` }))
const email = z.string().trim().min(3, "Enter an email address.").max(254, "Keep it to 254 characters.").email("Enter a valid email address.")

export const foundingCreateBody = z.strictObject({
  name: safeLine({ max: 40 }).min(2, { error: "Enter the brand name." }),
  handle,
  category: safeId(),
  city: safeLine({ max: 80 }).min(2, { error: "Enter the city." }),
  country: z.enum(countryCodes as [string, ...string[]], { error: "Choose one of Yard's markets." }),
  currency: z.enum(currencyCodes as [string, ...string[]], { error: "Choose one of Yard's currencies." }),
  story: safeText({ max: 2000 }).optional(),
  instagram: social(30, "Instagram").nullable().optional(),
  tiktok: social(24, "TikTok").nullable().optional(),
  /** One per "Create" action, reused on retry: a replay returns the brand already created. */
  idempotencyKey,
})
export type FoundingCreateBody = z.infer<typeof foundingCreateBody>

/** PATCH /api/admin/founding-brands/{id}. Before claim: profile, logo, banner and badge. After claim: the badge only. */
export const foundingPatchBody = z
  .strictObject({
    name: safeLine({ max: 40 }).min(2, { error: "Enter the brand name." }).optional(),
    city: safeLine({ max: 80 }).min(2, { error: "Enter the city." }).optional(),
    story: safeText({ max: 2000 }).nullable().optional(),
    instagram: social(30, "Instagram").nullable().optional(),
    tiktok: social(24, "TikTok").nullable().optional(),
    /** An upload of this brand (POST /api/uploads?as=admin&purpose=storefront_cover&brandId=). null removes it. */
    logoMediaId: safeId().nullable().optional(),
    /** The storefront banner: becomes the draft's coverMediaId. null removes it. */
    bannerMediaId: safeId().nullable().optional(),
    foundingBadge: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { error: "Send at least one change." })
export type FoundingPatchBody = z.infer<typeof foundingPatchBody>

export const foundingListQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const foundingHandleQuery = z.object({ handle: z.string().max(40) })

export const claimLinkBody = z.strictObject({ email, idempotencyKey })

const token = z.string().trim().min(40, "This link isn't complete. Open it from the email again.").max(64, "This link isn't valid.").regex(/^[\w-]+$/, "This link isn't valid.")
const name = z.string().trim().min(1, "Enter your name.").max(80, "Keep it to 80 characters.").regex(/^[^\u0000-\u001f\u007f<>]+$/, "Use letters, numbers and simple punctuation.")

export const claimPreviewBody = z.strictObject({ token })

export const claimAcceptBody = z.strictObject({
  token,
  /** Must be true: the claimant ticked "I accept the seller agreement". */
  acceptAgreement: z.boolean(),
  /** The version the page showed (SELLER_AGREEMENT_VERSION); a stale page is refused with 409. */
  agreementVersion: z.string().max(40),
  /** Only when no account has the claim email yet: these create one. */
  name: name.optional(),
  password: z.string().min(10, "Use at least 10 characters.").max(200, "Keep it to 200 characters.").optional(),
})
export type ClaimAcceptBody = z.infer<typeof claimAcceptBody>

export type FoundingBrandRow = {
  id: string
  handle: string
  name: string
  city: string
  country: string
  currency: string
  category: string | null
  story: string | null
  instagram: string | null
  tiktok: string | null
  logo: { mediaId: string; src: string } | null
  banner: { mediaId: string; src: string } | null
  foundingBadge: boolean
  reviewStatus: string
  claimStatus: "unclaimed" | "claimed"
  status: FoundingStatus
  createdAt: string | null
  launchedAt: string | null
  claimedAt: string | null
  claimedBy: { id: string; name: string } | null
  hasPayoutAccount: boolean
  storefrontPublished: boolean
  products: { total: number; published: number }
  claimLink: { id: string; email: string; status: "pending" | "expired"; createdAt: string; expiresAt: string } | null
}
