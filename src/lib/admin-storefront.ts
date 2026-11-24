/**
 * Admin › Brands › Publish / Unpublish storefront, and Admin › Finance › Payout accounts. Pure (no
 * React, no server imports), so the admin UI, the server (src/server/catalog/admin-storefront*.ts,
 * src/server/admin/payout-accounts-db.ts) and `tsx --test` read the same rules and words.
 *
 * A brand's shop is live on Yard when its storefront has been published (a storefront version
 * exists), Yard hasn't unpublished it (brands.unpublished_at), a founding brand has launched
 * (launched_at, set by its first publish), and the brand isn't restricted, suspended or closed.
 * Selling follows the sell rule (src/lib/sell-rule.ts, the twin of catalog/for-sale-sql.ts
 * brandForSaleSql): a payout account is never needed to sell (Yard holds the earnings and asks the
 * brand to add one); only an unclaimed founding brand never sells.
 */

import { notForSaleOf } from "./sell-rule"

export type PayoutAccountStatus = "none" | "pending" | "verified"

/**
 * A payout account's status: none; verified when a payment provider confirmed it (a Paystack
 * transfer recipient, the same rule as Studio's PayoutAccountDto.verified); pending when it is on
 * file but no provider has confirmed it (the stub recipient used with Bachs, where Yard pays by hand).
 */
export function payoutAccountStatus(a: { recipientCode: string | null; recipientProvider: string } | null | undefined): PayoutAccountStatus {
  if (!a) return "none"
  return a.recipientCode && a.recipientProvider !== "stub" ? "verified" : "pending"
}

export const payoutStatusLabel: Record<PayoutAccountStatus, string> = { none: "No account", pending: "Pending", verified: "Verified" }

export type AdminStorefrontFacts = {
  name: string
  founding: boolean
  claimStatus: string
  reviewStatus: string
  closed: boolean
  /** An application that isn't approved (draft, submitted, rejected). */
  underReview: boolean
  /** A storefront version exists. */
  hasVersion: boolean
  /** launched_at is set (founding brands go public with their first publish). */
  launched: boolean
  /** Yard unpublished the storefront (unpublished_at). */
  unpublished: boolean
  /** Published (or due scheduled) products passing moderation: what shoppers see at once. */
  liveProducts: number
  payoutAccount: boolean
}

/** Shoppers can find the shop now (the public catalogue's rule, catalog/sellable.ts brandListedSql). */
export function storefrontLive(f: AdminStorefrontFacts): boolean {
  return f.hasVersion && !f.unpublished && (!f.founding || f.launched) && statusOk(f)
}

const statusOk = (f: Pick<AdminStorefrontFacts, "reviewStatus" | "closed">) => !f.closed && f.reviewStatus !== "restricted" && f.reviewStatus !== "suspended"

/**
 * A founding brand its owner has claimed that isn't live yet (never launched, or no storefront
 * version): Admin's "Make live" (the Publish storefront action under that name). A shop Yard
 * unpublished on purpose isn't one; brands with "Go live when they claim" on went live at the claim.
 */
export function claimedNotLive(f: AdminStorefrontFacts): boolean {
  return f.founding && f.claimStatus === "claimed" && !f.unpublished && statusOk(f) && (!f.launched || !f.hasVersion)
}

/** The admin permission behind Publish, Unpublish and Make live (owners hold it; brands moderation too). */
export const STOREFRONT_PERMISSION = "brands.restrict"

/**
 * Why this admin can't publish or unpublish this brand, or null: the action needs brands.restrict,
 * and an unclaimed founding brand (Yard setup territory) also brands.founding. A claimed founding
 * brand needs only brands.restrict, so "Make live" is open to brands moderation right after a claim.
 */
export function storefrontRoleBlock(permissions: readonly string[], b: { name: string; founding: boolean; claimStatus: string }): string | null {
  if (!permissions.includes(STOREFRONT_PERMISSION)) return "Your role can't publish or unpublish storefronts."
  if (b.founding && b.claimStatus === "unclaimed" && !permissions.includes("brands.founding")) return `Only Yard owners can publish or unpublish ${b.name} before it's claimed.`
  return null
}

/** Hard stops for Publish: the button is disabled and the server refuses with this sentence. */
export function publishBlockers(f: AdminStorefrontFacts): string[] {
  const out: string[] = []
  if (f.closed) out.push(`${f.name} is closed, so its storefront can't be published.`)
  else if (f.reviewStatus === "suspended") out.push(`Yard has suspended ${f.name}. Reinstate it from Brands first.`)
  else if (f.reviewStatus === "restricted") out.push(`Yard has restricted ${f.name}, so publishing is paused. Lift the restriction first.`)
  if (!f.closed && f.underReview) out.push(`${f.name}'s application isn't approved yet. Approve it before publishing its storefront.`)
  return out
}

/** What goes live with a caveat: shown in the confirmation, never a refusal. */
export function publishWarnings(f: AdminStorefrontFacts): string[] {
  const out: string[] = []
  if (f.liveProducts <= 0) out.push("No live products, so the shop will show as empty until products are published.")
  if (notForSaleOf(f.claimStatus) === "unclaimed") out.push("Not claimed yet, so Buy stays off until the owner claims it.")
  else if (!f.payoutAccount) out.push("No payout account yet. The shop can take orders, but Yard can't pay the brand until it adds one in Studio.")
  return out
}

export type AdminStorefrontAction = "publish" | "unpublish"

/** What each button does now: run, nothing (already in that state), or a refusal. */
export function storefrontActionPlan(f: AdminStorefrontFacts, action: AdminStorefrontAction): { kind: "run" } | { kind: "already" } | { kind: "blocked"; message: string } {
  if (action === "unpublish") {
    if (f.closed) return { kind: "blocked", message: `${f.name} is closed: its storefront is already off the marketplace.` }
    if (f.unpublished || !f.hasVersion || (f.founding && !f.launched)) return { kind: "already" }
    return { kind: "run" }
  }
  const blockers = publishBlockers(f)
  if (blockers.length) return { kind: "blocked", message: blockers[0] }
  if (f.hasVersion && !f.unpublished && (!f.founding || f.launched)) return { kind: "already" }
  return { kind: "run" }
}

/**
 * The sell check for Admin › Finance › Payout accounts: a live storefront, a brand in good standing,
 * and the sell rule (src/lib/sell-rule.ts, the same rule checkout uses). A payout account is never a
 * blocker: a brand without one (ordinary, or a claimed founding brand) can sell, and `note` says to
 * add one so Yard can pay it.
 */
export function sellState(f: Pick<AdminStorefrontFacts, "claimStatus" | "reviewStatus" | "closed" | "hasVersion" | "founding" | "launched" | "unpublished" | "payoutAccount" | "underReview">): { canSell: boolean; reasons: string[]; note: string | null } {
  const reasons: string[] = []
  if (f.closed) reasons.push("Closed")
  else if (f.reviewStatus === "suspended") reasons.push("Suspended")
  else if (f.reviewStatus === "restricted") reasons.push("Restricted")
  else if (f.underReview || f.reviewStatus === "pending_review") reasons.push("In review")
  if (notForSaleOf(f.claimStatus) === "unclaimed") reasons.push("Not claimed")
  if (f.unpublished) reasons.push("Unpublished by Yard")
  else if (!f.hasVersion || (f.founding && !f.launched)) reasons.push("Storefront not published")
  const canSell = reasons.length === 0
  return { canSell, reasons, note: canSell && !f.payoutAccount ? "Add a payout account to get paid" : null }
}
