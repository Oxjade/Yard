import { z } from "zod"

/**
 * Admin › Brands › Delete brand (catalog/brand-removal.ts). The preview says which of the two
 * outcomes happens and why; the delete sends back the mode it showed, so a brand that took an
 * order in between is refused (409) instead of being closed without the admin seeing it.
 */
export const BRAND_REMOVAL_MODES = ["delete", "close"] as const
export type BrandRemovalMode = (typeof BRAND_REMOVAL_MODES)[number]

export const brandRemovalBody = z
  .object({
    mode: z.enum(BRAND_REMOVAL_MODES),
    /** The brand's handle, typed by the admin (without @, any case). */
    confirmHandle: z.string().trim().min(1).max(60),
    reason: z.string().trim().min(8, "Write at least 8 characters so the next person understands the decision.").max(500),
  })
  .strict()
export type BrandRemovalBody = z.infer<typeof brandRemovalBody>

export type BrandRemovalRecordsDto = {
  orders: number
  refunds: number
  returns: number
  disputes: number
  complaints: number
  payouts: number
  transfers: number
  ledgerEntries: number
  payoutAccounts: number
}

export type BrandRemovalFootprintDto = {
  products: number
  variants: number
  collections: number
  mediaFiles: number
  members: number
  invites: number
  imports: number
  watches: number
  suggestions: number
  newsletters: number
  notifications: number
  follows: number
  wishlist: number
  conversations: number
  posts: number
  places: number
  drops: number
  socialAccounts: number
  applications: number
}

export type BrandRemovalPreviewDto = {
  brand: { id: string; handle: string; name: string; reviewStatus: string; founding: boolean; claimStatus: string; closedAt: string | null }
  mode: BrandRemovalMode
  why: string
  records: BrandRemovalRecordsDto
  footprint: BrandRemovalFootprintDto
}

export type BrandRemovalResultDto = {
  mode: BrandRemovalMode
  brand: { id: string; handle: string; name: string }
  removed: Record<string, number>
  filesRemoved: number
  sessionsEnded: number
}
