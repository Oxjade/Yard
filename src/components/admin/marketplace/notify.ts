"use client"

import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"
import type { BrandApplication, Refund } from "@/lib/data/admin"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications } from "@/lib/stores/notifications"
import { useOrders } from "@/lib/stores/orders"

/*
 * Notifications for the other audiences when a Control Center decision here is about them.
 * Only real events in this browser: the Studio brand (the merchant signed in to Studio here)
 * and the shopper's own orders. Each event is keyed by the audit entry the decision wrote,
 * so it is pushed once and a later decision on the same record is its own event.
 */

const lastAuditId = () => useAdmin.getState().audit[0]?.id ?? String(Date.now())
const studioBrandName = () => brandById.get(STUDIO_BRAND_ID)?.name

/** Whether a brand is the one signed in to Studio in this browser, the only merchant who can be told. */
export function isStudioBrand(brand: { id?: string; name: string }) {
  return brand.id ? brand.id === STUDIO_BRAND_ID : brand.name === studioBrandName()
}

/**
 * The line a decision dialog adds when its reason will be shown outside the Control Center,
 * so the reviewer writes it for that reader. `sharesReason` is false where the notification
 * goes out without it.
 */
export function audienceLine(who: string, where: string, sharesReason = true) {
  return sharesReason ? `${who} is notified ${where} and sees your reason.` : `${who} is notified ${where}; your reason stays in the audit log.`
}

type BrandNoticeKey = "approve" | "verify" | "restrict" | "suspend" | "reinstate"

/** Merchant copy per decision, so reinstating doesn't read as a fresh verification. */
const brandCopy: Record<BrandNoticeKey, { title: string; body: (reason: string) => string }> = {
  approve: { title: "Your brand is approved", body: (r) => `NOCTURNE approved your application, so your brand can sell. Note from the review team: ${r}` },
  verify: { title: "The restriction on your brand is lifted", body: (r) => `Your brand is verified again: listings can show in discovery and search, and you can publish new products. Note from the review team: ${r}` },
  restrict: { title: "Your brand has been restricted", body: (r) => `Listings are held back from discovery and payouts are on hold while this is open. Reason: ${r}` },
  suspend: { title: "Your brand has been suspended", body: (r) => `Your storefront and payouts are on hold until the review team reinstates it. Reason: ${r}` },
  reinstate: { title: "Your brand is reinstated", body: (r) => `NOCTURNE lifted the suspension, so your storefront and listings are back. Held payouts are released after the standard reserve period. Note from the review team: ${r}` },
}

/** A decision on a brand's status. Tells the merchant when it is the Studio brand. */
export function notifyBrandDecision(app: BrandApplication, action: BrandNoticeKey, reason: string) {
  if (app.brandId !== STUDIO_BRAND_ID) return
  const c = brandCopy[action]
  useNotifications.getState().push({ eventKey: `m:brand:${app.id}:${lastAuditId()}`, audience: "merchant", category: "merchant_application", title: c.title, body: c.body(reason), href: "/studio/notifications", at: new Date().toISOString() })
}

export type ListingOutcome = "restricted" | "lifted" | "removed" | "dismissed" | "reopened" | "escalated"
/** Listing notifications that quote the reviewer's reason to the merchant. */
export const listingSharesReason: Record<ListingOutcome, boolean> = { restricted: true, lifted: true, removed: true, reopened: true, dismissed: false, escalated: false }

/** A moderation decision on a listing. Tells the merchant when the listing is the Studio brand's. */
export function notifyListingDecision(brand: { id?: string; name: string }, title: string, outcome: ListingOutcome, reason: string) {
  if (!isStudioBrand(brand)) return
  const copy = {
    restricted: { title: `Listing restricted: ${title}`, body: `It's held back from discovery and search while the restriction stands. Reason: ${reason}` },
    lifted: { title: `Restriction lifted: ${title}`, body: `The listing can show in discovery and search again. Note: ${reason}` },
    removed: { title: `Listing removed: ${title}`, body: `It can't be bought while the case is closed. Reason: ${reason}` },
    dismissed: { title: `Report closed: ${title}`, body: "The review team closed the report with no action. The listing stays up." },
    reopened: { title: `Report reopened: ${title}`, body: `The review team is looking at this listing again. Reason: ${reason}` },
    escalated: { title: `Listing under legal review: ${title}`, body: "The report was passed to legal. The listing stays up until legal decides." },
  }[outcome]
  useNotifications.getState().push({ eventKey: `m:listing:${title}:${lastAuditId()}`, audience: "merchant", category: "product_report", ...copy, href: "/studio/products", at: new Date().toISOString() })
}

/**
 * A Finance decision on a refund. The shopper hears about it when the order is theirs (placed
 * in this browser), and the merchant when it is the Studio brand's. Approving records the
 * decision only: no payments provider is connected, so nothing says money has moved.
 */
/** Who hears about a refund decision in this browser: the shopper when the order is theirs, the merchant when it's the Studio brand's. */
export function refundAudience(r: Refund) {
  const orderId = r.id.replace(/^rf_/, "")
  return { shopper: useOrders.getState().orders.some((o) => o.id === orderId), merchant: r.brandName === studioBrandName() }
}

export function notifyRefundDecision(r: Refund, status: "approved" | "declined", reason: string) {
  const push = useNotifications.getState().push
  const orderId = r.id.replace(/^rf_/, "")
  const order = useOrders.getState().orders.find((o) => o.id === orderId)
  const key = lastAuditId()
  const amount = formatMoney(r.amountUsd, "USD", { showCents: true })
  if (order) {
    push({
      eventKey: `c:refund-decision:${r.id}:${key}`,
      audience: "customer",
      category: "refund",
      title: status === "approved" ? `Refund approved for #${r.reference}` : `Refund declined for #${r.reference}`,
      body: status === "approved" ? `${amount} is approved. No payments provider is connected in this build, so nothing has been sent to your card yet.` : `NOCTURNE couldn't approve this refund: ${reason}`,
      href: `/you/orders/${order.id}`,
      at: new Date().toISOString(),
    })
  }
  if (r.brandName === studioBrandName()) {
    push({
      eventKey: `m:refund-decision:${r.id}:${key}`,
      audience: "merchant",
      category: "refund_request",
      title: status === "approved" ? `Refund approved on #${r.reference}` : `Refund declined on #${r.reference}`,
      body: status === "approved" ? `${amount} approved by Finance. It's sent once the payments provider is connected; your share and the commission reverse then.` : `Finance declined it: ${reason}`,
      href: `/studio/orders/${orderId}`,
      at: new Date().toISOString(),
    })
  }
}
