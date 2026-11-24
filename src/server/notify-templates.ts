import "server-only"
import { detectorLabels } from "@/lib/api/contracts/admin"

/**
 * Notification templates (§2.7). Titles and bodies come only from here. Variables are names,
 * references, dates, counts and reason labels: never message text, report details, captions or
 * complaint text. A variable longer than 80 characters is cut, so free text can't ride along.
 */
type Vars = Record<string, string | number | undefined>
type Template = { category: string; build: (v: Vars) => { title: string; body: string } }

const s = (v: string | number | undefined, fallback = "") => String(v ?? fallback).slice(0, 80)

/** A detector named as Admin › Charts labels it, whether the caller passed its key or a lower-cased label. */
const detector = (v: string | number | undefined) => {
  const raw = s(v, "unusual activity")
  const byLabel = Object.values(detectorLabels).find((l) => l.toLowerCase() === raw.toLowerCase())
  return detectorLabels[raw] ?? byLabel ?? raw.charAt(0).toUpperCase() + raw.slice(1)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
/** "week of 2 Nov" for the Monday of an edition's ISO week ('YYYY-MM-DD'), or null. */
const weekOf = (v: string | number | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ""))
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return `week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export const templates = {
  // Inbox (I)
  "message.new_for_brand": { category: "new_message", build: (v) => ({ title: `New message from ${s(v.customer, "a shopper")}`, body: "Open your inbox to reply." }) },
  "message.reply_for_shopper": { category: "new_message", build: (v) => ({ title: `${s(v.brand, "A brand")} replied`, body: "Open your inbox to read it." }) },
  // Yard Support (support threads): never the message text, never the admin's name.
  "support.reply_for_shopper": { category: "new_message", build: () => ({ title: "Yard Support replied", body: "Open your inbox to read it." }) },
  "support.reply_for_brand": { category: "new_message", build: () => ({ title: "Yard Support replied", body: "Open Yard Support in Studio to read it." }) },
  // `who`: the shopper's name, or the brand's name; `party`: "shopper" | "brand".
  "support.new_for_admin": { category: "support_message", build: (v) => ({ title: `Support: new message from ${s(v.who, v.party === "brand" ? "a brand" : "a shopper")}`, body: v.party === "brand" ? "A brand wrote to Yard Support. Open the Support queue to reply." : "A shopper wrote to Yard Support. Open the Support queue to reply." }) },
  // Suggestions from Yard (product proposals). Never the admin's note or name: the review page shows the note.
  // `count` (the website importer's batch): "Yard suggested 12 new products".
  "proposal.new_for_brand": {
    category: "product_suggestion",
    build: (v) =>
      Number(v.count) > 1
        ? { title: `Yard prepared ${Number(v.count)} products for you`, body: "Accept all in one tap. Nothing goes live until you accept." }
        : { title: v.product ? `Yard suggested a new product: ${s(v.product, "a product")}` : "Yard suggested a new product", body: "Review it in Studio. Nothing goes live until you accept." },
  },
  // A website watch found new pieces on the brand's own site (catalog/importer/watch.ts), once per check.
  "website.new_for_brand": {
    category: "product_suggestion",
    build: (v) => {
      const n = Math.max(1, Number(v.count) || 1)
      return { title: n === 1 ? "1 new piece from your website is waiting" : `${n} new pieces from your website are waiting`, body: "Add them to Yard in one tap." }
    },
  },
  "proposal.edit_for_brand": { category: "product_suggestion", build: (v) => ({ title: `Yard suggested changes to ${s(v.product, "a product")}`, body: "Review them in Studio. Nothing changes until you accept." }) },
  // `outcome`: "accepted" | "declined".
  "proposal.decided_for_admin": { category: "product_suggestion", build: (v) => ({ title: `${s(v.brand, "The brand")} ${v.outcome === "accepted" ? "accepted" : "declined"} your suggestion`, body: `${s(v.product, "A product")}. Open Suggestions for the details.` }) },
  // A batch (Accept all / Decline all): one notification per admin. `count`: how many of theirs; `outcome` as above.
  "proposal.batch_decided_for_admin": { category: "product_suggestion", build: (v) => ({ title: `${s(v.brand, "The brand")} ${v.outcome === "accepted" ? "accepted" : "declined"} ${Number(v.count) === 1 ? "1 of your suggestions" : `${s(v.count, "several")} of your suggestions`}`, body: "In one go, from Studio. Open Suggestions for the details." }) },
  // Reports (F2, M)
  // `subject` is the report's subject type; `brand` the owning brand's name. Never the reported text.
  "report.admin_new": { category: "message_report", build: (v) => ({ title: `New report: ${s(v.reason, "reported content")}`, body: v.subject === "conversation" ? `A conversation with ${s(v.brand, "a brand")}.` : `A message in a conversation with ${s(v.brand, "a brand")}.` }) },
  "report.admin_new_post": { category: "content_report", build: (v) => ({ title: `New report: ${s(v.reason, "reported post")}`, body: `A post by ${s(v.brand, "a brand")}.` }) },
  "report.admin_new_place": { category: "place_report", build: (v) => ({ title: `New report: ${s(v.reason, "reported place")}`, body: v.subject === "location_event" ? `An event at a place listed by ${s(v.brand, "a brand")}.` : `A place listed by ${s(v.brand, "a brand")}.` }) },
  "report.decided": { category: "report_update", build: (v) => ({ title: `We reviewed your report about ${s(v.subject, "something you reported")}`, body: "Thanks for helping keep Yard safe." }) },
  // Delivery (D)
  "delivery.shipped": { category: "delivery_update", build: (v) => ({ title: `${s(v.brand)} shipped your order`, body: `Estimated arrival ${s(v.range)}.` }) },
  "delivery.late": { category: "delivery_update", build: (v) => ({ title: `${s(v.brand)} is running late`, body: `New estimate ${s(v.range)}.` }) },
  "delivery.complaint_for_brand": { category: "delivery_complaint", build: (v) => ({ title: `Delivery problem on order ${s(v.reference)}`, body: `${s(v.kind, "A delivery problem")}. Open the order to respond.` }) },
  "delivery.complaint_reply": { category: "delivery_update", build: (v) => ({ title: `${s(v.brand)} replied about your delivery`, body: "Open your order to read it." }) },
  "delivery.admin_issue": { category: "shipping_issue", build: (v) => ({ title: `Delivery issue: ${s(v.kind, "late order")}`, body: `Order ${s(v.reference)} with ${s(v.brand)}.` }) },
  "delivery.resolved": { category: "delivery_update", build: (v) => ({ title: `Your delivery issue on ${s(v.reference)} is resolved`, body: "Open your order for the details." }) },
  // Courier shipping (docs/SHIPPING.md): the courier's own updates.
  "delivery.delivered": { category: "delivery_update", build: (v) => ({ title: `Your order from ${s(v.brand, "the brand")} was delivered`, body: `${s(v.courier, "The courier")} marked it delivered. Something wrong? Tell the brand from your order.` }) },
  "delivery.courier_wallet_low": { category: "shipping_issue", build: (v) => ({ title: `Courier wallet low: ${s(v.amount)}`, body: `Top up ${s(v.provider, "the courier wallet")} so brands can keep booking pickups.` }) },
  // To the brand: `step` is "picked up", "delivered" or "cancelled by the courier".
  "delivery.courier_for_brand": { category: "delivery_update", build: (v) => ({ title: `Order ${s(v.reference)}: ${s(v.step, "courier update")}`, body: `${s(v.courier, "The courier")}${v.tracking ? `, tracking ${s(v.tracking)}` : ""}.` }) },
  // A parcel that came back to the brand (shipment event `returned`, D's caller).
  "delivery.returned": { category: "delivery_update", build: (v) => ({ title: `${s(v.brand)} says your parcel came back to them`, body: "Open your order for what happens next." }) },
  // Social (S)
  "social.status": { category: "social_status", build: (v) => ({ title: `${s(v.provider, "Social")} needs attention`, body: s(v.detail, "Reconnect to keep your feed updating.") }) },
  // Content and places (M, A)
  "content.removed": { category: "content_moderation", build: (v) => ({ title: `Yard removed a ${s(v.kind, "post")}`, body: `Reason: ${s(v.reason, "it broke Yard's rules")}.` }) },
  // Admin › Users removed a person's profile photo; `reason` is the admin's reason.
  "account.photo_removed": { category: "content_moderation", build: (v) => ({ title: "Yard removed your profile photo", body: `Reason: ${s(v.reason, "it broke Yard's rules")}. You can add a new one in Settings.` }) },
  "location.review": { category: "location_review", build: (v) => ({ title: `${s(v.place, "Your place")}: ${s(v.outcome, "reviewed")}`, body: s(v.detail, "Open Locations for the details.") }) },
  // Charts (C, M)
  // `edition` ('YYYY-MM-DD', optional) names the week, so two editions never read as one notification twice.
  "chart.movement": { category: "chart_movement", build: (v) => ({ title: `${s(v.brand)} is #${s(v.rank)} on ${s(v.board)}${weekOf(v.edition) ? `, ${weekOf(v.edition)}` : " this week"}.`, body: v.sample ? "Rankings include sample activity in this build." : "See where you rank on Charts." }) },
  // `detector`: the detector key (ip_concentration) or its label in any case.
  "chart.integrity": { category: "chart_integrity", build: (v) => ({ title: `Chart integrity: ${detector(v.detector)}`, body: `${s(v.brand)}, ${s(v.severity, "high")} severity.` }) },
  // Abuse (I, M)
  "abuse.alert": { category: "abuse_alert", build: (v) => ({ title: `Abuse alert: ${s(v.kind, "spam marks")}`, body: `${s(v.count, "0")} signals about ${s(v.subject, "an account")}.` }) },
  "account.restricted": { category: "account_status", build: (v) => ({ title: `${s(v.what, "Messaging")} is paused on your account`, body: `Reason: ${s(v.reason)}.` }) },
  "brand.status": { category: "account_status", build: (v) => ({ title: `Yard ${s(v.status, "updated")} ${s(v.brand, "your brand")}`, body: `Reason: ${s(v.reason)}.` }) },
  // Founding brands: an owner claimed the store Yard set up.
  "brand.approved": { category: "account_status", build: (v) => ({ title: `${s(v.brand, "Your brand")} is approved`, body: "You can sell on Yard now. Add your pieces, set up your storefront and plan your first drop. Need guidance? Message @support from Yard Support in Studio." }) },
  "founding.claimed": { category: "account_status", build: (v) => ({ title: `${s(v.brand, "A founding brand")} was claimed`, body: `${s(v.owner, "Its owner")} is now the owner. Selling starts once a payout account is added.` }) },
  // F1 self-test (dev only)
  selftest: { category: "system_alert", build: (v) => ({ title: "Self-test notification", body: `Transaction self-test ${s(v.run)}.` }) },
} satisfies Record<string, Template>

export type TemplateKey = keyof typeof templates

export function render(key: TemplateKey, vars: Vars) {
  const t: Template = templates[key]
  return { category: t.category, ...t.build(vars) }
}
