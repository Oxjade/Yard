import { z } from "zod"
import { BRAND_REVIEW_STATUSES } from "./enums"

/**
 * Admin › Brands › All brands (server/admin/brands-directory-db.ts): every row of the brands
 * table, whatever its application says (none, draft, submitted, approved or rejected), closed
 * and founding brands included. The review-queue tabs list applications; this lists brands.
 */

/** A brand's latest application, or "none" when it never had one. */
export const ADMIN_BRAND_APPLICATION_STATES = ["none", "draft", "submitted", "approved", "rejected"] as const
export type AdminBrandApplicationState = (typeof ADMIN_BRAND_APPLICATION_STATES)[number]

/** `status` filter: "all", a review status (open brands only), closed, founding, or by application. */
export const ADMIN_BRAND_STATUS_FILTERS = ["all", ...BRAND_REVIEW_STATUSES, "closed", "founding", "claimed_not_live", "no_application", "draft", "rejected"] as const
export type AdminBrandStatusFilter = (typeof ADMIN_BRAND_STATUS_FILTERS)[number]

export const ADMIN_BRANDS_MAX_PAGE_SIZE = 200

export const adminBrandsQuery = z.object({
  /** Name, handle, city or country code (case-insensitive substring). */
  q: z.string().trim().max(120).optional(),
  status: z.enum(ADMIN_BRAND_STATUS_FILTERS).default("all"),
  /** 1-based. */
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(ADMIN_BRANDS_MAX_PAGE_SIZE).default(50),
})
export type AdminBrandsQuery = z.infer<typeof adminBrandsQuery>

export type AdminBrandRowDto = {
  id: string
  handle: string
  name: string
  country: string
  city: string
  /** The brand's first category slug, or null. */
  category: string | null
  reviewStatus: (typeof BRAND_REVIEW_STATUSES)[number]
  /** ISO time Yard closed the brand (Delete brand on a brand with orders), or null. */
  closedAt: string | null
  founding: boolean
  claimStatus: string
  /** Products on file, any status (drafts and archived included). */
  products: number
  /** When the brand joined, else when its application was submitted or started (ISO), or null. */
  since: string | null
  application: { id: string; status: Exclude<AdminBrandApplicationState, "none">; submittedAt: string | null } | null
  /** The shop on the marketplace: live (published, not unpublished by Yard, launched, in good standing), or unpublished by Yard. */
  storefront?: { live: boolean; unpublished: boolean; claimedNotLive?: boolean }
}

export type AdminBrandsDto = { items: AdminBrandRowDto[]; total: number; page: number; pageSize: number }
