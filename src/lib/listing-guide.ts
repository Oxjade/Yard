/**
 * "List your first product in 3 minutes": the Studio Overview checklist and the Draft / Live
 * wording used across Studio. Pure (no React, no server imports), so the rules are unit-tested
 * (listing-guide.test.ts) and the route, the card and the editor can't disagree.
 */

/** Where the brand stands, from server state only (GET /api/studio/setup `listing`). */
export type ListingFacts = {
  /** Products that aren't archived. */
  products: number
  /** Products that are published or scheduled. */
  live: number
  /**
   * The product the guide talks about while nothing is live: the most recently updated
   * product that isn't archived (usually the draft the brand left behind). Null with no products.
   */
  focus: { id: string; title: string; images: number; stock: number } | null
  /** A founding brand: hidden from shoppers until its storefront is published. */
  founding: boolean
  /** The storefront has been published at least once (brands.launched_at). */
  launched: boolean
  /** A payout account is on file. */
  payoutAccount: boolean
  /** The brand has an image logo (brands.logo_media_id). */
  logo: boolean
  /** The storefront (draft or live) has its own banner. */
  banner: boolean
  /** The storefront has been published at least once (any brand). */
  shopPublished: boolean
}

export const LISTING_STEP_KEYS = ["photos", "basics", "stock", "publish", "look", "shop", "payout"] as const
export type ListingStepKey = (typeof LISTING_STEP_KEYS)[number]

export type ListingStep = { key: ListingStepKey; title: string; body: string; href: string; done: boolean }

export const QUICK_ADD_HREF = "/studio/products/quick"
export const FULL_EDITOR_HREF = "/studio/products/new"
export const SHOP_SETUP_HREF = "/studio/storefront/quick"

const copy: Record<ListingStepKey, { title: string; body: string }> = {
  photos: { title: "Add photos", body: "Snap or upload at least one. Daylight is your best friend." },
  basics: { title: "Name & price", body: "What it's called and what it costs." },
  stock: { title: "Sizes & stock", body: "Tap the sizes you have and how many of each." },
  publish: { title: "Publish", body: "Drafts are invisible. Publishing puts it on Yard." },
  look: { title: "Logo & banner", body: "Your face on Yard: a square logo and one wide photo." },
  shop: { title: "Publish your shop", body: "Your logo, banner and line go live together." },
  payout: { title: "Add a payout account", body: "So your sales land in your bank." },
}

const productHref = (id: string, anchor: string) => `/studio/products/${encodeURIComponent(id)}#${anchor}`

/**
 * The checklist. Steps 1–4 are about getting one product live: once any product is published
 * (or scheduled) they're all done. Before that they read the focus product (a draft left behind
 * ticks what it already has and links straight to what's missing); with no product at all they
 * lead to Quick add. "Logo & banner" and "Publish your shop" lead to Set up your shop (a founding
 * brand's shop counts once launched, since it's hidden until then), and "Add a payout account"
 * shows only to someone who can see payouts (`showPayout`).
 */
export function listingSteps(facts: ListingFacts, opts: { showPayout: boolean }): ListingStep[] {
  const anyLive = facts.live > 0
  const focus = anyLive ? null : facts.focus
  const step = (key: ListingStepKey, done: boolean, href: string): ListingStep => ({ key, ...copy[key], done, href })
  const steps: ListingStep[] = [
    step("photos", anyLive || (!!focus && focus.images > 0), focus ? productHref(focus.id, "photos-panel") : QUICK_ADD_HREF),
    step("basics", anyLive || !!focus, focus ? productHref(focus.id, "pf-name") : QUICK_ADD_HREF),
    step("stock", anyLive || (!!focus && focus.stock > 0), focus ? productHref(focus.id, "variants-panel") : QUICK_ADD_HREF),
    step("publish", anyLive, focus ? productHref(focus.id, "publishing-panel") : facts.products > 0 ? "/studio/products" : QUICK_ADD_HREF),
  ]
  steps.push(step("look", facts.logo && facts.banner, SHOP_SETUP_HREF))
  const shop = step("shop", facts.founding ? facts.launched : facts.shopPublished, `${SHOP_SETUP_HREF}?step=review`)
  steps.push(facts.founding ? { ...shop, body: "Founding brands stay hidden until the shop is published." } : shop)
  if (opts.showPayout) steps.push(step("payout", facts.payoutAccount, "/studio/settings#payouts"))
  return steps
}

export type ListingGuide = {
  steps: ListingStep[]
  done: number
  total: number
  /** Every step is done: the card moves on to the feature setup (or hides). */
  complete: boolean
  /** The one step to do next, for the card's main button. */
  next: ListingStep | null
}

export function listingGuide(facts: ListingFacts, opts: { showPayout: boolean }): ListingGuide {
  const steps = listingSteps(facts, opts)
  const done = steps.filter((s) => s.done).length
  return { steps, done, total: steps.length, complete: done === steps.length, next: steps.find((s) => !s.done) ?? null }
}

/** The main button on the card: what the next step means in plain words. */
export function nextActionLabel(guide: ListingGuide, facts: ListingFacts) {
  const next = guide.next
  if (!next) return null
  if (next.key === "publish") return facts.focus && facts.live === 0 ? `Publish ${shortTitle(facts.focus.title)}` : "Open your products"
  if (next.key === "look") return "Set up your shop"
  if (next.key === "shop") return "Publish my shop"
  if (next.key === "payout") return "Add payout account"
  return facts.focus && facts.live === 0 ? "Finish your draft" : "Start with Quick add"
}

const shortTitle = (t: string) => (t.length > 22 ? "your draft" : t)

/* ---------- Draft vs Live ---------- */

export type ListingTone = "draft" | "live" | "waiting" | "archived"

/**
 * The status pill for one product, said so nobody can mistake a draft for a listing:
 * a draft is invisible; published is live only when the brand itself is visible (a founding
 * brand before its storefront is published isn't); scheduled waits for its time.
 */
export function listingPill(status: string, brand: { hidden: boolean } = { hidden: false }): { label: string; short: string; tone: ListingTone; hint: string } {
  if (status === "published") {
    return brand.hidden
      ? { label: "Published: storefront not live yet", short: "Waiting on storefront", tone: "waiting", hint: "Shoppers see it as soon as your storefront is published." }
      : { label: "Live on Yard", short: "Live on Yard", tone: "live", hint: "Shoppers can find it, save it and buy it." }
  }
  if (status === "scheduled") return { label: "Scheduled: not live yet", short: "Scheduled", tone: "waiting", hint: "It goes live at its go-live time." }
  if (status === "archived") return { label: "Archived", short: "Archived", tone: "archived", hint: "Set aside in Studio. Shoppers can't see it." }
  return { label: "Draft: only you can see this", short: "Draft: only you", tone: "draft", hint: "Shoppers can't see drafts. Publish it to put it on Yard." }
}

/** A founding brand whose storefront isn't published yet: its products are hidden. */
export const brandHidden = (facts: Pick<ListingFacts, "founding" | "launched"> | null | undefined) => !!facts && facts.founding && !facts.launched
