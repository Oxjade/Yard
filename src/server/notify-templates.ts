import "server-only"

/**
 * Notification templates (§2.7). Titles and bodies come only from here. Variables are names,
 * references, dates, counts and reason labels: never message text, report details, captions or
 * complaint text. A variable longer than 80 characters is cut, so free text can't ride along.
 */
type Vars = Record<string, string | number | undefined>
type Template = { category: string; build: (v: Vars) => { title: string; body: string } }

const s = (v: string | number | undefined, fallback = "") => String(v ?? fallback).slice(0, 80)

export const templates = {
  // Inbox (I)
  "message.new_for_brand": { category: "new_message", build: (v) => ({ title: `New message from ${s(v.customer, "a shopper")}`, body: "Open your inbox to reply." }) },
  "message.reply_for_shopper": { category: "new_message", build: (v) => ({ title: `${s(v.brand, "A brand")} replied`, body: "Open your inbox to read it." }) },
  // Reports (F2, M)
  "report.admin_new": { category: "message_report", build: (v) => ({ title: `New report: ${s(v.reason, "reported content")}`, body: `${s(v.subject, "Report")} · ${s(v.brand, "Yard")}` }) },
  "report.admin_new_post": { category: "content_report", build: (v) => ({ title: `New report: ${s(v.reason, "reported post")}`, body: `Post report · ${s(v.brand, "Yard")}` }) },
  "report.admin_new_place": { category: "place_report", build: (v) => ({ title: `New report: ${s(v.reason, "reported place")}`, body: `${s(v.subject, "Place report")} · ${s(v.brand, "Yard")}` }) },
  "report.decided": { category: "report_update", build: (v) => ({ title: `We reviewed your report about ${s(v.subject, "something you reported")}`, body: "Thanks for helping keep Yard safe." }) },
  // Delivery (D)
  "delivery.shipped": { category: "delivery_update", build: (v) => ({ title: `${s(v.brand)} shipped your order`, body: `Estimated arrival ${s(v.range)}.` }) },
  "delivery.late": { category: "delivery_update", build: (v) => ({ title: `${s(v.brand)} is running late`, body: `New estimate ${s(v.range)}.` }) },
  "delivery.complaint_for_brand": { category: "delivery_complaint", build: (v) => ({ title: `Delivery problem on order ${s(v.reference)}`, body: `${s(v.kind, "A delivery problem")}. Open the order to respond.` }) },
  "delivery.complaint_reply": { category: "delivery_update", build: (v) => ({ title: `${s(v.brand)} replied about your delivery`, body: "Open your order to read it." }) },
  "delivery.admin_issue": { category: "shipping_issue", build: (v) => ({ title: `Delivery issue: ${s(v.kind, "late order")}`, body: `Order ${s(v.reference)} · ${s(v.brand)}` }) },
  "delivery.resolved": { category: "delivery_update", build: (v) => ({ title: `Your delivery issue on ${s(v.reference)} is resolved`, body: "Open your order for the details." }) },
  // Social (S)
  "social.status": { category: "social_status", build: (v) => ({ title: `${s(v.provider, "Social")} needs attention`, body: s(v.detail, "Reconnect to keep your feed updating.") }) },
  // Content and places (M, A)
  "content.removed": { category: "content_moderation", build: (v) => ({ title: `Yard removed a ${s(v.kind, "post")}`, body: `Reason: ${s(v.reason, "it broke Yard's rules")}.` }) },
  "location.review": { category: "location_review", build: (v) => ({ title: `${s(v.place, "Your place")}: ${s(v.outcome, "reviewed")}`, body: s(v.detail, "Open Locations for the details.") }) },
  // Charts (C, M)
  "chart.movement": { category: "chart_movement", build: (v) => ({ title: `${s(v.brand)} is #${s(v.rank)} on ${s(v.board)} this week.`, body: v.sample ? "Rankings include sample activity in this build." : "See where you rank on Charts." }) },
  "chart.integrity": { category: "chart_integrity", build: (v) => ({ title: `Chart integrity: ${s(v.detector, "unusual activity")}`, body: `${s(v.brand)} · ${s(v.severity, "high")} severity` }) },
  // Abuse (I, M)
  "abuse.alert": { category: "abuse_alert", build: (v) => ({ title: `Abuse alert: ${s(v.kind, "spam marks")}`, body: `${s(v.subject, "An account")} · ${s(v.count, "0")} signals` }) },
  "account.restricted": { category: "account_status", build: (v) => ({ title: `${s(v.what, "Messaging")} is paused on your account`, body: `Reason: ${s(v.reason)}.` }) },
  "brand.status": { category: "account_status", build: (v) => ({ title: `Yard ${s(v.status, "updated")} ${s(v.brand, "your brand")}`, body: `Reason: ${s(v.reason)}.` }) },
  // F1 self-test (dev only)
  selftest: { category: "system_alert", build: (v) => ({ title: "Self-test notification", body: `Transaction self-test ${s(v.run)}.` }) },
} satisfies Record<string, Template>

export type TemplateKey = keyof typeof templates

export function render(key: TemplateKey, vars: Vars) {
  const t: Template = templates[key]
  return { category: t.category, ...t.build(vars) }
}
