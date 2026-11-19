/**
 * Who may see a public product or brand page, as one pure rule (src/server/catalog/page-exists.ts
 * and the opens-soon reads in src/server/catalog/public.ts apply it; the SQL behind the public
 * catalogue, src/server/catalog/sellable.ts productPublicWhere, says the same for "public").
 *
 * - "public": the normal page.
 * - "opens-soon": the piece (or brand) is ready but its founding brand hasn't published its
 *   storefront yet (launched_at null). Shoppers get a friendly "opens soon" page with the brand
 *   and a Follow button, never the piece's photos, price or details; the brand's own members get a
 *   preview with "Publish my shop".
 * - "none": not found. Drafts, archived, scheduled-not-due, moderation-hidden pieces, and anything
 *   of a restricted or suspended brand (or a sample brand in production) stay not-found.
 */
export type PageVisibility = "public" | "opens-soon" | "none"

export type VisibilityBrand = {
  founding: boolean
  launchedAt: Date | null
  reviewStatus: string
  /** A bundled sample brand while production refuses samples (sample-guard.ts). */
  sample?: boolean
}

export type VisibilityProduct = {
  status: string
  publishAt: Date | null
  moderationStatus: string
}

/** A brand Yard lists: not restricted or suspended, not a refused sample. Launch is separate. */
const brandStanding = (b: VisibilityBrand) => !b.sample && b.reviewStatus !== "restricted" && b.reviewStatus !== "suspended"

/** A founding brand is public once its storefront is published; ordinary brands always are. */
const brandLaunched = (b: VisibilityBrand) => !b.founding || b.launchedAt !== null

export function brandPageVisibility(b: VisibilityBrand | null | undefined): PageVisibility {
  if (!b || !brandStanding(b)) return "none"
  return brandLaunched(b) ? "public" : "opens-soon"
}

/** Published, or scheduled and due (before the job flips it), and not hidden by moderation. */
export function productReady(p: VisibilityProduct, now = new Date()) {
  const live = p.status === "published" || (p.status === "scheduled" && p.publishAt !== null && p.publishAt.getTime() <= now.getTime())
  return live && p.moderationStatus === "ok"
}

export function productPageVisibility(p: VisibilityProduct | null | undefined, b: VisibilityBrand | null | undefined, now = new Date()): PageVisibility {
  if (!p || !productReady(p, now)) return "none"
  return brandPageVisibility(b)
}

/** The founding-brand copy, in one place for the page, the not-found fallback and the metadata. */
export const opensSoonTitle = (brandName: string) => `${brandName} opens soon on Yard`
export const opensSoonPieceLine = "This piece goes live when their shop opens."
export const opensSoonBrandLine = "Their shop isn't open yet. Follow them to hear the moment it is."
export const memberPreviewLine = (what: string) => `Only you can see this. Your shop isn't live yet, so shoppers can't see ${what}.`
