import { z } from "zod"
import { safeLine } from "./common"
import { foundingCreateBody, type FoundingBrandRow } from "./founding"
import { importChoiceBody, type ImportDetailDto, type WatchDto } from "./imports"
import type { DuplicateReason } from "@/lib/from-website"

/**
 * Create brand from website (Admin › Brands › Founding, docs/IMPORTER.md › Create brand from
 * website): paste a brand's own site, check what Yard found, Create store. One flow over the
 * existing pieces: the importer's scan (with no brand yet), the founding-brand create, the import
 * as Suggestions from Yard with the storefront draft filled from the site, website watching and
 * "Go live when they claim". Plain zod, so the page validates with the server's rules.
 */

/** POST /api/admin/founding-brands/from-website */
export const websiteScanBody = z.strictObject({
  url: safeLine({ max: 2000 }).min(4, { error: "Paste the brand's website address." }),
  consent: z.literal(true, { error: "Confirm the brand agreed to us building their Yard store from their website." }),
})
export type WebsiteScanBody = z.output<typeof websiteScanBody>

const imageUrl = z.url({ protocol: /^https?$/, error: "Choose one of the site's images." }).max(2000)

/** POST /api/admin/founding-brands/from-website/{importId}/create */
export const websiteCreateBody = z.strictObject({
  /** The founding brand as reviewed: the same fields and rules as "Create founding brand", with the request key. */
  brand: foundingCreateBody,
  /** One of the site's images (the scan's logo, banner or product photos), or null for none. */
  logoUrl: imageUrl.nullable(),
  bannerUrl: imageUrl.nullable(),
  /** The ticked products as edited, priced in the brand's currency. */
  products: z.array(importChoiceBody).max(200),
  goLiveOnClaim: z.boolean(),
  watch: z.boolean(),
  foundingBadge: z.boolean(),
})
export type WebsiteCreateBody = z.output<typeof websiteCreateBody>

/** An existing brand that looks like the one about to be created. */
export type WebsiteDuplicateDto = { id: string; name: string; handle: string; founding: boolean; claimed: boolean; reasons: DuplicateReason[]; href: string }

/** Yard's best guesses for the brand card, each editable. */
export type WebsiteSuggestionDto = {
  name: string
  handle: string
  /** The first handle that's free (the suggested one, or the next of its variants); null when none is. */
  handleAvailable: boolean
  category: string | null
  city: string
  country: string | null
  currency: string | null
  /** Why Yard guessed the place and currency ("Labeld shops are Nigerian"). */
  why: string[]
  location: string | null
  story: string
  instagram: string | null
  tiktok: string | null
  logo: string | null
  banner: string | null
  /** Images on the site to choose the logo and banner from: the site's own first, then product photos. */
  images: string[]
}

/** What Create store did, once it ran. */
export type WebsiteCreatedDto = {
  brand: FoundingBrandRow
  watch: WatchDto | null
  /** The brand's founding tray in Admin › Brands › Founding. */
  trayHref: string
}

export type WebsiteScanDto = {
  import: Omit<ImportDetailDto, "context">
  suggestion: WebsiteSuggestionDto | null
  duplicates: WebsiteDuplicateDto[]
  created: WebsiteCreatedDto | null
}
