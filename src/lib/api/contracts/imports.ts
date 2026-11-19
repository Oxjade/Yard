import { z } from "zod"
import { currencyCodes } from "@/config/markets"
import { safeId, safeLine, safeText } from "./common"
import { IMPORT_ITEM_STATUSES, IMPORT_PLATFORMS, IMPORT_STATUSES, SITE_PIECE_STATUSES, WATCH_STATUSES } from "./enums"

/**
 * Import from website (Admin › Brands › a brand › Products › Import from website, docs/IMPORTER.md).
 * An admin pastes the brand's own shop address; Yard scans it in the background (Shopify,
 * WooCommerce, Labeld, then any site with schema.org Product data), the admin edits and ticks
 * products in a preview, and Yard copies the photos into its own media and sends the ticked
 * products to the brand as Suggestions from Yard (src/server/catalog/proposals.ts). Plain zod, no
 * server-only: the admin page validates with the same rules as /api/admin/brand-imports.
 */

export { IMPORT_ITEM_STATUSES, IMPORT_PLATFORMS, IMPORT_STATUSES, SITE_PIECE_STATUSES, WATCH_STATUSES }
export type ImportPlatform = (typeof IMPORT_PLATFORMS)[number]
export const IMPORT_PLATFORM_LABELS: Record<ImportPlatform, string> = { shopify: "Shopify", woocommerce: "WooCommerce", labeld: "Labeld", generic: "Product pages (schema.org)" }

export type ImportStatus = (typeof IMPORT_STATUSES)[number]
export type ImportItemStatus = (typeof IMPORT_ITEM_STATUSES)[number]

/** Product pages one scan reads at most (listing pages and sitemaps don't count). */
export const IMPORT_MAX_PRODUCTS = 200
/** Photos copied per product at most (the product form holds 12). */
export const IMPORT_MAX_IMAGES = 8
export const ONE_SIZE = "One size"

export type ImportAvailability = "in_stock" | "out_of_stock" | "preorder" | "unknown"
export type ImportOptionDto = { name: string; values: { value: string; hex?: string }[] }
export type ImportVariantDto = {
  options: Record<string, string>
  /** On-hand count when the site shows it (null: unknown). */
  stock: number | null
  /** A price for this variant only, minor units (null: the product's). */
  priceMinor: number | null
  available: boolean | null
}

/** One product as the scan found it, normalised (prices in the source currency's minor units). */
export type ImportProductDto = {
  /** Stable within a scan: the source's product id, else its URL. */
  key: string
  sourceUrl: string
  sourceId: string | null
  title: string
  description: string
  priceMinor: number | null
  compareAtMinor: number | null
  /** ISO code as the site states it; null when it doesn't. */
  currency: string | null
  images: string[]
  options: ImportOptionDto[]
  variants: ImportVariantDto[]
  availability: ImportAvailability
  /** A guess from the name and type; null when nothing matched (the brand's category is used). */
  categorySlug: string | null
  subcategory: string | null
  processingDays: [number, number] | null
  tags: string[]
  warnings: string[]
  /** Set when it looks like something the brand already has (unticked by default). */
  duplicate: { reason: string } | null
}

export type ImportBrandDto = {
  name: string | null
  logo: string | null
  banner: string | null
  description: string | null
  socials: { instagram: string | null; tiktok: string | null; links: string[] }
  /** Where the site says the brand is ("Minimal Street · Lagos State, Nigeria"); absent on scans before it was read. */
  location?: string | null
}

export type ImportProgressDto = { phase: "start" | "detect" | "listing" | "products" | "images" | "done"; pagesFetched: number; productsFound: number; productPages: number; note: string | null }

export type ImportItemDto = {
  key: string
  title: string
  sourceUrl: string
  status: ImportItemStatus
  reason: string | null
  proposalId: string | null
  /** The suggestion's own status once created (pending, accepted…). */
  proposalStatus: string | null
  images: { done: number; total: number }
  /** The first photo as copied into Yard (admin media URL), once there is one. */
  cover: string | null
  /** The price the admin chose (the suggestion's), when the item was ticked. */
  price: { minor: number; currency: string } | null
  updatedAt: string
}

export type ImportBrandContextDto = {
  id: string
  name: string
  handle: string
  currency: string
  category: string | null
  founding: boolean
  claimStatus: "claimed" | "unclaimed"
  goLiveOnClaim: boolean
  /** Logo, banner and description can be applied (unclaimed founding brand, brands.founding). */
  canUseSiteProfile: boolean
  has: { logo: boolean; banner: boolean; story: boolean; instagram: boolean; tiktok: boolean }
}

export type ImportSummaryDto = {
  id: string
  /** Null while a "Create brand from website" scan has no brand yet. */
  brandId: string | null
  sourceUrl: string
  platform: ImportPlatform | null
  status: ImportStatus
  createdAt: string
  updatedAt: string
  createdBy: string | null
  products: number
  counts: Record<ImportItemStatus, number>
}

export type ImportDetailDto = ImportSummaryDto & {
  progress: ImportProgressDto
  error: string | null
  warnings: string[]
  brand: ImportBrandDto | null
  /** Scan results (empty while scanning). */
  found: ImportProductDto[]
  items: ImportItemDto[]
  /** What the admin chose for the storefront draft. */
  profile: { logo: boolean; banner: boolean; description: boolean; socials: boolean; applied: boolean; error: string | null } | null
  categories: { slug: string; name: string; subcategories: string[] }[]
  context: ImportBrandContextDto
}

export type ImportListDto = { brand: ImportBrandContextDto; imports: ImportSummaryDto[] }

/* ---------- request bodies ---------- */

/** POST /api/admin/brand-imports */
export const importScanBody = z.strictObject({
  brandId: safeId(),
  url: safeLine({ max: 2000 }).min(4, { error: "Paste the brand's website address." }),
  consent: z.literal(true, { error: "Confirm the brand agreed to the import." }),
})
export type ImportScanBody = z.output<typeof importScanBody>

const minor = z.number().int().positive({ error: "Enter a price above zero." }).max(1_000_000_000_000)

/** One ticked product as the admin edited it in the preview. */
export const importChoiceBody = z.strictObject({
  key: safeLine({ max: 400 }).min(1),
  title: safeLine({ max: 120 }).min(2, { error: "Name the product." }),
  priceMinor: minor,
  currency: z.enum(currencyCodes as [string, ...string[]], { error: "Choose one of Yard's currencies." }),
  categorySlug: safeId(),
  subcategory: safeLine({ max: 60 }).nullable().optional(),
  /** The size values in order; empty means one size. Replaces a single Size option. */
  sizes: z.array(safeLine({ max: 40 }).min(1)).max(40).optional(),
  /** Stock per variant label ("M", "M / Black", or "One size"). */
  stock: z.record(safeLine({ max: 120 }), z.number().int().min(0).max(1_000_000)).default({}),
  /** Import it even though it looks like a duplicate. */
  allowDuplicate: z.boolean().default(false),
})
export type ImportChoiceBody = z.output<typeof importChoiceBody>

/** POST /api/admin/brand-imports/{id}/import */
export const importRunBody = z.strictObject({
  products: z.array(importChoiceBody).max(200),
  profile: z.strictObject({ logo: z.boolean(), banner: z.boolean(), description: z.boolean(), socials: z.boolean() }).optional(),
  note: safeText({ max: 300 }).optional(),
})
export type ImportRunBody = z.output<typeof importRunBody>

export const importListQuery = z.object({ brandId: safeId() })

/* ---------- watching a website (docs/IMPORTER.md › Watching a website) ---------- */

export type WatchStatus = (typeof WATCH_STATUSES)[number]
export type SitePieceStatus = (typeof SITE_PIECE_STATUSES)[number]

/** A brand's watched website as Admin shows it. */
export type WatchDto = {
  brandId: string
  sourceUrl: string
  platform: ImportPlatform
  enabled: boolean
  status: WatchStatus
  /** Why it paused itself after repeated failures. */
  pausedNote: string | null
  failures: number
  lastError: string | null
  lastScanAt: string | null
  lastOkAt: string | null
  nextScanAt: string | null
  /** A check is running now (Check now, or the scheduler). */
  checking: boolean
  lastRun: { new: number; changes: number; requests: number; products: number } | null
  everyHours: number
}

/** One "New from your website" piece (waiting for approval), as either side previews it. */
export type SitePieceDto = {
  id: string
  title: string
  sourceUrl: string
  /** Photos as the site serves them (copied into Yard only on approval). */
  images: string[]
  priceMinor: number | null
  currency: string | null
  /** The price Yard will use, in the brand's currency (converted at Yard's reference rate when the site's differs). */
  yardPriceMinor: number | null
  sizes: string[]
  availability: ImportAvailability
  description: string
  warnings: string[]
  status: SitePieceStatus
  /** Who took it, while an approval is running. */
  taken: "admin" | "brand" | null
  firstSeenAt: string
  /** The last approval that failed, when one did. */
  error: string | null
}

/** A price change or sell-out on a piece already in Yard: flagged, never applied. */
export type SiteChangeDto = {
  id: string
  title: string
  sourceUrl: string
  price: { from: number; to: number; currency: string | null } | null
  soldOut: boolean
  at: string
  productId: string | null
  proposalId: string | null
}

export type AdminWatchDto = { brand: ImportBrandContextDto; watch: WatchDto | null; pieces: SitePieceDto[]; changes: SiteChangeDto[]; seen: number }
export type StudioSitePiecesDto = { items: SitePieceDto[]; count: number; mayAdd: boolean; site: string | null; currency: string }

/** PUT /api/admin/brand-watch */
export const watchSetBody = z.strictObject({
  brandId: safeId(),
  enabled: z.boolean(),
  /** The import whose address (and platform) to watch; the brand's latest scanned one when left out. */
  importId: safeId().optional(),
})
export type WatchSetBody = z.output<typeof watchSetBody>

/** POST /api/admin/brand-watch/check */
export const watchCheckBody = z.strictObject({ brandId: safeId(), resume: z.boolean().optional() })

/** POST /api/admin/website-pieces/{id} */
export const adminPieceActionBody = z.strictObject({ action: z.enum(["approve", "skip", "dismiss_change"]) })
/** POST /api/admin/website-pieces */
export const adminPiecesBulkBody = z.strictObject({ brandId: safeId(), action: z.literal("approve_all") })
/** POST /api/studio/website-pieces/{id} */
export const studioPieceActionBody = z.strictObject({ action: z.enum(["add", "skip"]) })
