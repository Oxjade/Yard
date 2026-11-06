"use client"

import { site } from "@/config/site"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"
import type { BrandApplication, Refund } from "@/lib/data/admin"
import { customerOrders, merchantOrders, sampleReturnRequest } from "@/lib/data/orders"
import { formatMoney } from "@/lib/money"
import { returnRefund } from "@/lib/payouts"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications } from "@/lib/stores/notifications"
import { useOrders } from "@/lib/stores/orders"
import { useStudio } from "@/lib/stores/studio"

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

/**
 * Who reads the reason outside the Control Center, from a decision's description. It lives with
 * the ReasonDialog now, which labels its field with it for every caller; re-exported here for
 * code that already imports it from this module.
 */
export { reasonReader } from "@/components/admin/ui/reason-dialog"

type BrandNoticeKey = "approve" | "verify" | "restrict" | "suspend" | "reinstate"

/** Merchant copy per decision, so reinstating doesn't read as a fresh verification. */
const brandCopy: Record<BrandNoticeKey, { title: string; body: (reason: string) => string }> = {
  approve: { title: "Your brand is approved", body: (r) => `${site.name} approved your application, so your brand can sell. Note from the review team: ${r}` },
  verify: { title: "The restriction on your brand is lifted", body: (r) => `Your brand is verified again: listings can show in discovery and search, and you can publish new products. Note from the review team: ${r}` },
  restrict: { title: "Your brand has been restricted", body: (r) => `Listings are held back from discovery and payouts are on hold while this is open. Reason: ${r}` },
  suspend: { title: "Your brand has been suspended", body: (r) => `Your storefront and payouts are on hold until the review team reinstates it. Reason: ${r}` },
  reinstate: { title: "Your brand is reinstated", body: (r) => `${site.name} lifted the suspension, so your storefront and listings are back. Held payouts are released after the standard reserve period. Note from the review team: ${r}` },
}

/**
 * A decision on a brand's status. Tells the merchant when it is the Studio brand, as an
 * account status notification (a new application reaching the review team is
 * merchant_application; this is the answer to it, and every later status change).
 */
export function notifyBrandDecision(app: BrandApplication, action: BrandNoticeKey, reason: string) {
  if (app.brandId !== STUDIO_BRAND_ID) return
  const c = brandCopy[action]
  useNotifications.getState().push({ eventKey: `m:brand:${app.id}:${lastAuditId()}`, audience: "merchant", category: "account_status", title: c.title, body: c.body(reason), href: "/studio/notifications", at: new Date().toISOString() })
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

/** Who hears about a refund decision in this browser: the shopper when the order is theirs, the merchant when it's the Studio brand's. */
export function refundAudience(r: Refund) {
  const orderId = r.id.replace(/^rf_/, "")
  return { shopper: useOrders.getState().orders.some((o) => o.id === orderId), merchant: r.brandName === studioBrandName() }
}

/**
 * A Finance decision on a refund, for the one case the event layer can't see. When the order has
 * a copy in this browser's stores (the shopper's own orders, the Studio brand's), setRefundStatus
 * puts the decision on the order and src/lib/notification-events.ts tells the shopper and the
 * brand from it, in the order's currency, under the same keys (so this never sends it twice).
 * What's left is a Studio brand refund whose order the stores don't hold: the merchant hears in
 * the event layer's words. A shopper can only be told about their own orders, which are always
 * in the stores. Approving records the decision only: nothing says money has moved.
 */
export function notifyRefundDecision(r: Refund, status: "approved" | "declined", reason: string) {
  if (r.brandName !== studioBrandName()) return
  const orderId = r.id.replace(/^rf_/, "")
  const held = (list: { id: string }[]) => list.some((o) => o.id === orderId)
  if (held(useOrders.getState().orders) || held(useStudio.getState().orders)) return
  // The sample order the refund was raised on gives the amount in the order's own currency.
  const order = [...customerOrders, ...merchantOrders].find((o) => o.id === orderId)
  const amount = order ? formatMoney(returnRefund(order, (order.returnRequest ?? sampleReturnRequest(order)).variantIds).amount, order.currency) : null
  const why = reason.trim().replace(/\.$/, "")
  useNotifications.getState().push({
    eventKey: `m:refund-decision:${r.id}:${lastAuditId()}`,
    audience: "merchant",
    category: "refund_request",
    title: status === "declined" ? `Return declined on #${r.reference}` : `Refund approved on #${r.reference}`,
    body:
      status === "declined"
        ? `Finance declined the return${why ? `: ${why}` : ""}.`
        : `Finance approved ${amount ?? "the refund"}. It's recorded and sent once a payment provider is connected; your share and the commission reverse then.`,
    // The order isn't in Studio's store, so the link opens the orders list rather than a missing order.
    href: "/studio/orders",
    at: new Date().toISOString(),
  })
}
