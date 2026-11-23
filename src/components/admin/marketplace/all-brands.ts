import type { AdminBrandApplicationState, AdminBrandRowDto, AdminBrandStatusFilter } from "../../../lib/api/contracts/admin-brands"
import type { BrandApplication } from "../../../lib/data/admin"

/**
 * Admin › Brands › All brands: every brand in the brands table, not only those with an
 * application in review. A row opens the same review sheet as the queue: the brand's own
 * application when the queue lists one, else a record made from the brand itself (`brand:<id>`).
 * Kept free of React so the tests run it.
 */

export const ALL_BRANDS_TAB = "all"
const PREFIX = "brand:"

/** The `?review=` id of a brand opened from All brands without an application in the queue. */
export const allBrandsRecordId = (brandId: string) => `${PREFIX}${brandId}`
export const isAllBrandsRecordId = (id: string | null | undefined): id is string => !!id && id.startsWith(PREFIX)

const EPOCH = new Date(0).toISOString()

export const applicationLabel: Record<AdminBrandApplicationState, string> = {
  none: "No application",
  draft: "Draft application",
  submitted: "Application submitted",
  approved: "Application approved",
  rejected: "Application rejected",
}

const NOTES: Record<AdminBrandApplicationState, string> = {
  none: "No application on file: the brand was created without one (seeded, founding, or made by Yard).",
  draft: "The latest application is a draft the brand hasn't submitted.",
  submitted: "The latest application is waiting in the review queue.",
  approved: "The latest application was approved.",
  rejected: "The latest application was rejected. The applicant can edit and resubmit it.",
}

export const applicationState = (row: AdminBrandRowDto): AdminBrandApplicationState => row.application?.status ?? "none"

/** The review-sheet record for a brand listed in All brands (status, closed and product count from the server). */
export function brandRowToApplication(row: AdminBrandRowDto): BrandApplication {
  const application = applicationState(row)
  return {
    id: allBrandsRecordId(row.id),
    brandName: row.name,
    handle: row.handle,
    country: row.country,
    category: row.category ?? "—",
    // The sheet only shows this date when `listing.dated` says it's on record.
    submittedAt: row.since ?? EPOCH,
    status: row.reviewStatus,
    kyc: "not_started",
    risk: "medium",
    notes: `${NOTES[application]}${row.founding ? " A founding brand set up by Yard." : ""}`,
    products: row.products,
    brandId: row.id,
    closedAt: row.closedAt ?? undefined,
    listing: { application, dated: !!row.since, founding: row.founding },
  }
}

/**
 * What opening a row in All brands shows: the brand's application from the review queue when it
 * has one listed there (same sheet, same decisions), else the brand's own record.
 */
export function openTargetFor(row: AdminBrandRowDto, queue: BrandApplication[]): string {
  return queue.find((a) => a.brandId === row.id)?.id ?? allBrandsRecordId(row.id)
}

/** The record a `?review=` id names: one from the review queue, else a brand from All brands. */
export function resolveReview(reviewId: string | null, queue: BrandApplication[], all: AdminBrandRowDto[] | undefined): BrandApplication | undefined {
  if (!reviewId) return undefined
  const fromQueue = queue.find((a) => a.id === reviewId)
  if (fromQueue) return fromQueue
  if (!isAllBrandsRecordId(reviewId) || !all) return undefined
  const row = all.find((b) => allBrandsRecordId(b.id) === reviewId)
  return row ? brandRowToApplication(row) : undefined
}

/** Whether a brand matches the All brands status filter (the same rules as GET /api/admin/brands?status=). */
export function matchesBrandFilter(row: AdminBrandRowDto, filter: AdminBrandStatusFilter): boolean {
  switch (filter) {
    case "all":
      return true
    case "closed":
      return !!row.closedAt
    case "founding":
      return row.founding
    case "no_application":
      return !row.application
    case "draft":
    case "rejected":
      return row.application?.status === filter
    default:
      return !row.closedAt && row.reviewStatus === filter
  }
}

export const brandFilterOptions: { value: Exclude<AdminBrandStatusFilter, "all">; label: string }[] = [
  { value: "pending_review", label: "Pending review" },
  { value: "verified", label: "Verified" },
  { value: "restricted", label: "Restricted" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
  { value: "founding", label: "Founding" },
  { value: "no_application", label: "No application" },
  { value: "draft", label: "Draft application" },
  { value: "rejected", label: "Rejected application" },
]
