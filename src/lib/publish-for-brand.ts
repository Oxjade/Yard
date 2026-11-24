/**
 * "Publish storefront for {brand}" (Admin › Brands, the brand and founding trays) and "Go live when
 * they claim" (founding brands). Pure (no React, no server imports), so the admin tray, the server
 * (src/server/catalog/publish-for-brand.ts) and `tsx --test` read the same rules and words.
 *
 * Publishing for a brand goes through the brand's own publish (storefront.ts publishDraft): the
 * same draft, the same checks, the same version history. Only who is recorded differs.
 */

/** What the tray shows before an admin publishes, and what the server checks again. */
export type PublishForBrandFacts = {
  name: string
  founding: boolean
  claimStatus: "none" | "unclaimed" | "claimed" | string
  reviewStatus: string
  /** An onboarding application that isn't approved (draft, submitted, rejected). */
  underReview: boolean
  /** A storefront version exists (the shop has been published at least once). */
  published: boolean
  logo: boolean
  banner: boolean
  intro: boolean
  /** Published (or due scheduled) products that pass moderation: what shoppers see at once. */
  liveProducts: number
}

export const EMPTY_SHOP_WARNING = "Shop will show as empty"

export type ChecklistItem = { key: "logo" | "banner" | "intro" | "products"; label: string; done: boolean; value?: string }

/** The small checklist before publishing: logo ✓, banner ✓, intro ✓, live products N (a warning, never a block). */
export function publishChecklist(f: Pick<PublishForBrandFacts, "logo" | "banner" | "intro" | "liveProducts">): { items: ChecklistItem[]; warning: string | null } {
  const n = Math.max(0, Math.floor(f.liveProducts))
  return {
    items: [
      { key: "logo", label: "Logo", done: f.logo },
      { key: "banner", label: "Banner", done: f.banner },
      { key: "intro", label: "Intro", done: f.intro },
      { key: "products", label: "Live products", done: n > 0, value: String(n) },
    ],
    warning: n === 0 ? EMPTY_SHOP_WARNING : null,
  }
}

/**
 * Why an admin can't publish this brand's storefront now, or null when they can. Already
 * published is not a refusal: the action is then a no-op (see publishForBrandOutcome).
 *
 * Unclaimed founding brands are allowed: Yard already launches them itself today (Yard setup
 * publishes the storefront from Studio, storefront.ts sets launched_at), so this is the same act
 * from the tray. They're still never for sale until claimed (sellable.ts brandForSaleSql).
 */
export function publishForBrandBlock(f: Pick<PublishForBrandFacts, "name" | "reviewStatus" | "underReview">): string | null {
  if (f.reviewStatus === "suspended") return `Yard has suspended ${f.name}. Reinstate it from Brands first.`
  if (f.reviewStatus === "restricted") return `Yard has restricted ${f.name}, so publishing is paused. Lift the restriction first.`
  if (f.underReview) return `${f.name}'s application isn't approved yet. Approve it before publishing its storefront.`
  return null
}

/** What pressing the button does: publish, nothing (already published), or a refusal. */
export function publishForBrandOutcome(f: PublishForBrandFacts): { kind: "publish" } | { kind: "already" } | { kind: "blocked"; message: string } {
  if (f.published) return { kind: "already" }
  const block = publishForBrandBlock(f)
  return block ? { kind: "blocked", message: block } : { kind: "publish" }
}

/** The tray shows the button only while the storefront has never been published. */
export const showPublishForBrand = (f: Pick<PublishForBrandFacts, "published">) => !f.published

export const publishForBrandLabel = (brand: string) => `Publish storefront for ${brand}`

/* ---------- Go live when they claim ---------- */

/** New founding brands start with the switch on; ones created before it existed keep it off. */
export const GO_LIVE_ON_CLAIM_DEFAULT = true

export type ClaimGoLivePlan = { publish: boolean; acceptSuggestions: boolean }

/**
 * What the claim does with the Yard-prepared shop. With the switch on: accept Yard's pending
 * suggestions, then publish the storefront unless it's already published. With it off: nothing
 * (the owner publishes from Studio, as before).
 */
export function claimGoLivePlan(x: { goLiveOnClaim: boolean; published: boolean }): ClaimGoLivePlan {
  if (!x.goLiveOnClaim) return { publish: false, acceptSuggestions: false }
  return { publish: !x.published, acceptSuggestions: true }
}

export type SuggestionOutcome<T> = { accepted: { id: string; result: T }[]; skipped: { id: string; reason: string }[] }

/**
 * Accepts each pending suggestion on its own (oldest first). One that fails validation is
 * skipped and stays pending for the owner to answer in Studio; it never fails the claim. `accept`
 * runs each in its own transaction, so a failure rolls back only that suggestion.
 */
export async function acceptEachSuggestion<T>(ids: string[], accept: (id: string) => Promise<T>, reasonOf: (e: unknown) => string = defaultReason): Promise<SuggestionOutcome<T>> {
  const out: SuggestionOutcome<T> = { accepted: [], skipped: [] }
  for (const id of ids) {
    try {
      out.accepted.push({ id, result: await accept(id) })
    } catch (e) {
      out.skipped.push({ id, reason: reasonOf(e) })
    }
  }
  return out
}

const defaultReason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200)

/** An edit suggestion is answered against the product it was made for: a product changed since is left for the owner. */
export function suggestionStillFits(s: { kind: string; baseVersion: number | null }, productVersion: number | null): boolean {
  if (s.kind !== "edit") return true
  return s.baseVersion != null && productVersion != null && s.baseVersion === productVersion
}

/* ---------- Copy ---------- */

export const CLAIM_GOES_LIVE_COPY = "Your shop goes live the moment you claim it. Change anything later in Studio."
/** Every brand, founding or not (lib/sell-rule.ts): the shop takes orders already, and the account is where Yard pays it. */
export const PAYOUT_TO_GET_PAID_COPY = "Your shop can take orders now. One thing left: add your payout account so Yard can pay you. Takes about 2 minutes."
export const PAYOUTS_PATH = "/studio/settings#payouts"
export const shopPath = (handle: string) => `/brands/${handle}`
/** "yardstore.space/brands/handle": the link as a person reads it. */
export const shopDisplay = (origin: string, handle: string) => `${origin.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${shopPath(handle)}`
