"use client"

import { useEffect } from "react"
import { countries, type CountryCode } from "@/config/markets"
import { site } from "@/config/site"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"
import { categoryBySlug, drops } from "@/lib/data/catalog"
import { brandApplications, disputes, failedJobs, moderationQueue, payoutAmountIn, webhookFailures, type BrandApplication, type Payout } from "@/lib/data/admin"
import { campaignDates, type Campaign } from "@/lib/data/ads"
import { customerOrders } from "@/lib/data/orders"
import { availableStock, productById } from "@/lib/data/products"
import { daysAgo } from "@/lib/data/seed"
import type { CategorySlug, Drop, MerchantOrder } from "@/lib/data/types"
import { dropPhaseAt } from "@/lib/drops"
import { getDemoAnchor } from "@/hooks/use-now"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { adminLinks, useNotifications, type AppNotification } from "@/lib/stores/notifications"
import { useOrders } from "@/lib/stores/orders"
import { useSaved } from "@/lib/stores/saved"
import { useStudio, type InventoryEvent } from "@/lib/stores/studio"

type New = Omit<AppNotification, "id" | "read"> & { read?: boolean }

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`
/** Pieces on a return request (quantities, not lines). */
const returnedUnits = (o: MerchantOrder) => o.lines.filter((l) => o.returnRequest?.variantIds.includes(l.variantId)).reduce((s, l) => s + l.quantity, 0)

/** A payout's amount in the brand's own currency, as the brand sees it in Studio. */
const payoutMoney = (p: Payout) => formatMoney(payoutAmountIn(p, p.currency), p.currency)

/** Payout status copy for the merchant. Nothing reads as paid until a provider confirms a transfer. */
function payoutCopy(p: Payout): { title: string; body: string } {
  const amount = `${payoutMoney(p)} via ${p.method}`
  switch (p.status) {
    case "processing":
      return { title: "Payout approved", body: `${amount}. The approval is recorded; the transfer is sent once a payment provider is connected, and completes when it confirms.` }
    case "held":
      return { title: "Payout on hold", body: `${amount}.${p.holdReason ? ` Reason: ${p.holdReason}` : ""} It stays in your balance until the platform team releases it.` }
    case "scheduled":
      return { title: "Payout released", body: `${amount}, back on the schedule for ${dayFmt.format(new Date(p.scheduledFor))}. Nothing is sent until a payment provider is connected.` }
    case "awaiting_approval":
      return { title: "Payout under review", body: `${amount}. Waiting for the platform team.` }
    case "paid":
      return { title: "Payout completed", body: `${amount}. The provider confirmed the transfer.` }
  }
}

/** The merchant's word for why a variant's stock reached zero, from the stock change that did it. */
function outOfStockBody(label: string, reason?: InventoryEvent["reason"]) {
  if (reason === "sale") return `${label} just sold out.`
  if (reason === "damaged") return `${label} is now out of stock after stock was marked damaged.`
  if (reason === "adjustment") return `${label} is now out of stock after a stock adjustment.`
  if (reason === "reservation") return `${label} is now out of stock: what's left is reserved.`
  return `${label} is now out of stock.`
}

/** A drop alert for the shopper, worded for how the drop sells: a draw's release closes entries. */
function dropLiveCopy(d: Drop, brandName: string) {
  if (d.access === "draw") {
    // The shopper entered before release; at release entries close and winners are picked.
    return {
      title: `Entries for ${d.name} have closed`,
      body: `${brandName} released it by draw. Your entry is in and winners are still to be picked. Picking winners isn't connected in this build, so no one has been picked or charged.`,
    }
  }
  return { title: `${d.name} is live`, body: `${brandName} just released it. ${d.unitsLeft} of ${d.totalUnits} left.` }
}

/** Customer copy for a decision on their return request. An approval is recorded, never sent, in this build. */
function returnDecisionCopy(o: MerchantOrder): { title: string; body: string } | null {
  const d = o.returnRequest?.decision
  if (!d) return null
  const ref = `#${o.reference}`
  const who = d.by === "brand" ? (brandById.get(o.brandId)?.name ?? "The brand") : site.name
  if (d.status === "declined") return { title: `Return declined for ${ref}`, body: d.reason ? `${who} declined it: ${d.reason}.` : `${who} declined it.` }
  const amount = formatMoney(d.amount ?? 0, o.currency)
  const count = returnedUnits(o)
  const notSent = "It's approved and recorded, and sent to how you paid once a payment provider is connected. Nothing has reached your card yet."
  return d.partial
    ? { title: `Partial refund approved for ${ref}`, body: `${who} approved a partial refund of ${amount} for ${items(count)}. ${notSent}` }
    : { title: `Refund approved for ${ref}`, body: `${who} approved a refund of ${amount}. ${notSent}` }
}

/**
 * Notification keys for a decision. A platform decision is keyed by the audit entry it wrote, the
 * same key the Finance decision dialogs use, so the two never send it twice.
 */
const decisionKey = (audience: "c" | "m", o: MerchantOrder) => {
  const d = o.returnRequest?.decision
  return d?.by === "platform" && d.ref ? `${audience}:refund-decision:rf_${o.id}:${d.ref}` : `${audience}:return-decision:${o.id}`
}

/**
 * "7 November": a campaign's start as the merchant sees it in Studio and the Admin review queue
 * shows it (campaignDates: counted from today in the brand's time zone).
 */
function campaignStart(c: Campaign) {
  return dayFmt.format(new Date(`${campaignDates(c, Date.now()).start}T12:00:00Z`))
}

/* ── Seeds: derived from events already present in the sample data ─────────── */

function customerSeed(): New[] {
  const out: New[] = []
  for (const o of customerOrders) {
    const brand = brandById.get(o.brandId)!
    const ref = `#${o.reference}`
    if (["shipped", "delivered", "refunded"].includes(o.status) && o.tracking) {
      out.push({ eventKey: `c:shipped:${o.id}`, audience: "customer", category: "order_shipped", title: `${brand.name} shipped your order`, body: `${ref} is on its way with ${o.tracking.carrier}.`, href: `/you/orders/${o.id}`, at: o.placedAt, sample: true, read: o.status !== "shipped" })
    }
    if (o.status === "delivered") out.push({ eventKey: `c:delivered:${o.id}`, audience: "customer", category: "order_delivered", title: "Delivered", body: `${ref} from ${brand.name} was delivered.`, href: `/you/orders/${o.id}`, at: o.placedAt, sample: true, read: true })
    if (o.status === "refunded") out.push({ eventKey: `c:refund:${o.id}`, audience: "customer", category: "refund", title: "Refund issued", body: `${formatMoney(o.total, o.currency)} for ${ref} is back on your card.`, href: `/you/orders/${o.id}`, at: o.placedAt, sample: true, read: true })
  }
  return out
}

function merchantSeed(): New[] {
  const studio = useStudio.getState()
  const brand = brandById.get(studio.brandId)!
  const out: New[] = []
  for (const o of studio.orders.filter((x) => x.status === "paid").slice(0, 5)) {
    out.push({ eventKey: `m:order:${o.id}`, audience: "merchant", category: "new_order", title: `New order #${o.reference}`, body: `${o.lines.length} item${o.lines.length > 1 ? "s" : ""}, ${formatMoney(o.total, o.currency)}. Payment verified, ready to fulfil.`, href: `/studio/orders/${o.id}`, at: o.placedAt, sample: true })
  }
  // One alert per product, not per size.
  for (const p of studio.products) {
    const out0 = p.variants.filter((v) => availableStock(v) === 0)
    if (!out0.length) continue
    const labels = out0.map((v) => Object.values(v.options).join(", ") || "One size")
    const all = out0.length === p.variants.length
    out.push({
      eventKey: `m:oos:${p.id}:seed`,
      audience: "merchant",
      category: "out_of_stock",
      title: all ? `${p.name} is sold out` : `${p.name}: ${out0.length} variant${out0.length > 1 ? "s" : ""} out of stock`,
      body: all ? "Every variant has sold out. Restock or archive it." : `${labels.slice(0, 3).join("; ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""}.`,
      href: "/studio/inventory",
      at: daysAgo(1),
      sample: true,
      read: true,
    })
  }
  for (const c of studio.campaigns.filter((c) => c.status === "in_review" || c.status === "rejected")) {
    out.push({ eventKey: `m:campaign:${c.id}:${c.status}`, audience: "merchant", category: "campaign_review", title: c.status === "rejected" ? `Campaign rejected: ${c.name}` : `Campaign in review: ${c.name}`, body: c.status === "rejected" ? c.rejectionReason ?? "See the reason in Advertising." : "Reviews usually take under a day.", href: "/studio/advertising", at: daysAgo(1), sample: true })
  }
  const po = useAdmin.getState().payouts.find((p) => p.brandId === brand.id)
  if (po) out.push({ eventKey: `m:payout:${po.id}:${po.status}`, audience: "merchant", category: "payout_status", ...payoutCopy(po), href: "/studio/payouts", at: daysAgo(2), sample: true, read: true })
  return out
}

/** "the United Kingdom", "Kenya": a country's name as it reads after "from". */
function fromCountry(code: string) {
  const name = countries[code as CountryCode]?.name ?? code
  return /^United /.test(name) ? `the ${name}` : name
}

/** "Home & lifestyle brand from the United Kingdom, 3 products drafted.": a new application, wherever it is announced. */
export function applicationBody(a: Pick<BrandApplication, "category" | "country" | "products">) {
  const category = categoryBySlug.get(a.category as CategorySlug)?.name ?? a.category.replace(/-/g, " ")
  const kind = category.charAt(0).toUpperCase() + category.slice(1)
  const drafted = a.products ? `${a.products} ${a.products === 1 ? "product" : "products"} drafted` : "no products drafted yet"
  return `${kind} brand from ${fromCountry(a.country)}, ${drafted}.`
}

function adminSeed(): New[] {
  const out: New[] = []
  for (const a of brandApplications.filter((a) => a.status === "pending_review" && !a.brandId)) {
    out.push({ eventKey: `a:app:${a.id}`, audience: "admin", category: "merchant_application", title: `New brand application: ${a.brandName}`, body: applicationBody(a), href: adminLinks.application(a.id), at: a.submittedAt, sample: true })
  }
  for (const m of moderationQueue.filter((m) => m.status === "open" || m.status === "escalated")) {
    out.push({ eventKey: `a:report:${m.id}`, audience: "admin", category: "product_report", title: `Listing reported: ${m.title}`, body: `${m.brandName}. ${m.detail}`, href: adminLinks.report(m.id), at: m.reportedAt, sample: true })
  }
  for (const w of webhookFailures) {
    out.push({ eventKey: `a:webhook:${w.id}`, audience: "admin", category: "payment_failure", title: `${w.provider.charAt(0).toUpperCase()}${w.provider.slice(1)} webhook failed`, body: `${w.event}: ${w.reason}`, href: adminLinks.webhooks, at: w.receivedAt, sample: true })
  }
  for (const d of disputes.filter((d) => d.type === "chargeback" && d.stage === "needs_evidence")) {
    out.push({ eventKey: `a:cb:${d.id}`, audience: "admin", category: "chargeback", title: `Chargeback opened on #${d.reference}`, body: `${d.brandName}, ${formatMoney(d.amountUsd, "USD")}: ${d.reason}. Evidence due soon.`, href: adminLinks.dispute(d.id), at: d.openedAt, sample: true })
  }
  const risky = brandApplications.find((a) => a.risk === "high" && a.status === "restricted")
  if (risky) out.push({ eventKey: `a:risk:${risky.id}`, audience: "admin", category: "suspicious_activity", title: `High-risk brand: ${risky.brandName}`, body: risky.notes, href: adminLinks.application(risky.id), at: risky.submittedAt, sample: true, read: true })
  for (const j of failedJobs.slice(0, 1)) {
    out.push({ eventKey: `a:job:${j.id}`, audience: "admin", category: "system_alert", title: `Background job failing: ${j.queue}`, body: `${j.name}: ${j.error}`, href: adminLinks.failedJobs, at: j.failedAt, sample: true })
  }
  for (const r of useAdmin.getState().refunds.filter((r) => r.status === "requested").slice(0, 3)) {
    out.push({ eventKey: `a:refund:${r.id}`, audience: "admin", category: "refund_request" as AppNotification["category"], title: `Refund requested on #${r.reference}`, body: `${r.brandName}, ${formatMoney(r.amountUsd, "USD")}: ${r.reason}.`, href: adminLinks.refund(r.id), at: r.requestedAt, sample: true })
  }
  return out
}

/**
 * Sample notifications saved before the sample data was corrected (a carrier, an amount, a
 * reference, a link) read what the same event says now. Matched by event key; read state,
 * time and anything raised in this browser stay as they are.
 */
function refreshSamples(fresh: New[]) {
  const byKey = new Map(fresh.map((n) => [n.eventKey, n]))
  const { items } = useNotifications.getState()
  let changed = false
  const next = items.map((n) => {
    const f = n.sample ? byKey.get(n.eventKey) : undefined
    if (!f || (f.title === n.title && f.body === n.body && f.href === n.href)) return n
    changed = true
    return { ...n, title: f.title, body: f.body, href: f.href }
  })
  if (changed) useNotifications.setState({ items: next })
}

/* ── Live events: subscribe to the stores and turn changes into notifications ─ */

/**
 * Mounted once at the root. Seeds each audience from the sample data the first time,
 * then listens to the application stores for real events in this browser — and to the
 * persisted notification store from other tabs.
 */
export function useNotificationEvents() {
  useEffect(() => {
    const push = (x: New) => useNotifications.getState().push(x)

    // Wait for the persisted stores to rehydrate before seeding or diffing.
    const ready = () => [useNotifications, useStudio, useAdmin, useOrders, useSaved].every((s) => s.persist.hasHydrated())
    const unsubs: (() => void)[] = []

    const start = () => {
      const state = useNotifications.getState()
      const seeds = { customer: customerSeed(), merchant: merchantSeed(), admin: adminSeed() }
      if (!state.seeded.customer) { state.pushMany(seeds.customer); state.setSeeded("customer") }
      if (!state.seeded.merchant) { state.pushMany(seeds.merchant); state.setSeeded("merchant") }
      if (!state.seeded.admin) { state.pushMany(seeds.admin); state.setSeeded("admin") }
      // Stock alerts say what the stock was when they were raised, so they keep their wording.
      refreshSamples([...seeds.customer, ...seeds.merchant.filter((n) => !n.eventKey.startsWith("m:oos:")), ...seeds.admin])

      // Customer + merchant: checkout created orders.
      unsubs.push(
        useOrders.subscribe((s, prev) => {
          const added = s.groups.filter((g) => !prev.groups.some((p) => p.id === g.id))
          for (const g of added) {
            const orders = s.orders.filter((o) => o.groupId === g.id)
            push({ eventKey: `c:placed:${g.id}`, audience: "customer", category: "order_confirmed", title: `Order ${g.reference} placed`, body: `${orders.length} brand order${orders.length > 1 ? "s" : ""}. Awaiting payment confirmation from the provider.`, href: "/you/orders", at: g.placedAt })
            for (const o of orders.filter((o) => o.brandId === STUDIO_BRAND_ID)) {
              push({ eventKey: `m:order:${o.id}`, audience: "merchant", category: "new_order", title: `New order #${o.reference}`, body: `${o.lines.length} item${o.lines.length > 1 ? "s" : ""}, ${formatMoney(o.total, o.currency)}. Wait for payment confirmation before fulfilling.`, href: `/studio/orders`, at: o.placedAt })
            }
          }
          // Customer, merchant, admin: a return request on a delivered order.
          for (const o of s.orders) {
            const before = prev.orders.find((x) => x.id === o.id)
            if (!o.returnRequest || before?.returnRequest) continue
            const brand = brandById.get(o.brandId)
            const r = o.returnRequest
            push({ eventKey: `c:return:${o.id}`, audience: "customer", category: "refund", title: `Return requested for #${o.reference}`, body: `${brand?.name ?? "The brand"} will reply with return instructions.`, href: `/you/orders/${o.id}`, at: r.at })
            if (o.brandId === STUDIO_BRAND_ID) push({ eventKey: `m:return:${o.id}`, audience: "merchant", category: "refund_request", title: `Return requested on #${o.reference}`, body: `${o.shippingAddress.name}: ${r.reasonLabel.toLowerCase()}.`, href: `/studio/orders/${o.id}`, at: r.at })
            push({ eventKey: `a:return:${o.id}`, audience: "admin", category: "refund_request", title: `Refund requested on #${o.reference}`, body: `${brand?.name ?? "Brand"}: ${r.reasonLabel.toLowerCase()}.`, href: adminLinks.refund(`rf_${o.id}`), at: r.at })
          }
          // Customer: the brand or the platform decided their return request.
          for (const o of s.orders) {
            const d = o.returnRequest?.decision
            if (!d || prev.orders.find((x) => x.id === o.id)?.returnRequest?.decision) continue
            const c = returnDecisionCopy(o)
            if (c) push({ eventKey: decisionKey("c", o), audience: "customer", category: "refund", ...c, href: `/you/orders/${o.id}`, at: d.at })
          }
        }),
      )

      // Customer: the brand moves one of the shopper's orders on in Studio. In this build the
      // shopper's copy and the brand's copy are two stores; this keeps them in step (the backend
      // phase has one row) and tells the shopper.
      unsubs.push(
        useStudio.subscribe((s, prev) => {
          const mine = useOrders.getState().orders
          for (const o of s.orders) {
            const before = prev.orders.find((x) => x.id === o.id)
            if (!before || (before.status === o.status && before.tracking === o.tracking)) continue
            // Merchant: the platform decided a return on the brand's order (the brand's own decisions it made itself).
            const d = o.returnRequest?.decision
            if (d?.by === "platform" && !before.returnRequest?.decision) {
              const amount = formatMoney(d.amount ?? 0, o.currency)
              push({
                eventKey: decisionKey("m", o),
                audience: "merchant",
                category: "refund_request",
                title: d.status === "declined" ? `Return declined on #${o.reference}` : `${d.partial ? "Partial refund" : "Refund"} approved on #${o.reference}`,
                body: d.status === "declined" ? `Finance declined the return${d.reason ? `: ${d.reason}` : ""}. The order is back to delivered.` : `Finance approved ${amount}${d.partial ? ` for ${items(returnedUnits(o))}; the rest of the order stays delivered` : ""}. It's recorded and sent once a payment provider is connected; your share and the commission reverse then.`,
                href: `/studio/orders/${o.id}`,
                at: d.at,
              })
            }
            const theirs = mine.find((x) => x.id === o.id)
            if (!theirs) continue
            useOrders.setState({ orders: useOrders.getState().orders.map((x) => (x.id === o.id ? { ...x, status: o.status, paymentStatus: o.paymentStatus, tracking: o.tracking, timeline: o.timeline, returnRequest: o.returnRequest ?? x.returnRequest, refund: o.refund ?? x.refund, cancelReason: o.cancelReason ?? x.cancelReason, delivery: o.delivery ?? x.delivery, shippedAt: o.shippedAt ?? x.shippedAt, deliveredAt: o.deliveredAt ?? x.deliveredAt } : x)) })
            if (before.status === o.status) continue
            // A decided return is announced from the decision itself (see the orders events above), not as "delivered".
            if (before.status === "refund_requested" && d) continue
            const brand = brandById.get(o.brandId)?.name ?? "The brand"
            const copy: Partial<Record<typeof o.status, { category: AppNotification["category"]; title: string; body: string }>> = {
              shipped: { category: "order_shipped", title: `#${o.reference} is on its way`, body: o.tracking ? `${brand} shipped it with ${o.tracking.carrier}, tracking ${o.tracking.number}.` : `${brand} shipped it.` },
              delivered: before.status === "refund_requested"
                ? { category: "refund", title: `Return update for #${o.reference}`, body: `${brand} closed your return request without a refund. The order shows what changed.` }
                : { category: "order_delivered", title: `#${o.reference} was delivered`, body: `Returns are open for ${brandById.get(o.brandId)?.returnsDays ?? 14} days.` },
              refunded: { category: "refund", title: `Refund recorded for #${o.reference}`, body: `${brand} marked it refunded. No payment provider is connected in this build, so nothing has reached your card yet.` },
              cancelled: { category: "refund", title: `#${o.reference} was cancelled`, body: o.cancelReason ? `${brand}: ${o.cancelReason}` : `${brand} cancelled it.` },
            }
            const c = copy[o.status]
            if (c) push({ eventKey: `c:status:${o.id}:${o.status}`, audience: "customer", ...c, href: `/you/orders/${o.id}`, at: new Date().toISOString() })
          }
        }),
      )

      // Merchant: stock crossing the low / out-of-stock thresholds after an adjustment.
      unsubs.push(
        useStudio.subscribe((s, prev) => {
          for (const p of s.products) {
            const before = prev.products.find((x) => x.id === p.id)
            if (!before) continue
            for (const v of p.variants) {
              const old = before.variants.find((x) => x.id === v.id)
              if (!old) continue
              const a = availableStock(old)
              const b = availableStock(v)
              const label = Object.values(v.options).join(", ") || "One size"
              // The stock change that did it says why: a sale sells out; damage or an adjustment doesn't.
              const cause = s.inventoryLog.find((e) => e.variantId === v.id && !prev.inventoryLog.includes(e))
              // The product is out of stock only when every variant is; otherwise name the variant.
              const all = p.variants.every((x) => availableStock(x) === 0)
              if (b === 0 && a > 0) push({ eventKey: `m:oos:${v.id}:${Date.now()}`, audience: "merchant", category: "out_of_stock", title: all ? `${p.name} is out of stock` : `${p.name}: ${label} out of stock`, body: outOfStockBody(label, cause?.reason), href: "/studio/inventory", at: new Date().toISOString() })
              else if (b > 0 && b <= 3 && a > 3) push({ eventKey: `m:low:${v.id}:${Date.now()}`, audience: "merchant", category: "low_inventory", title: `Low stock: ${p.name}`, body: `${label} has ${b} left.`, href: "/studio/inventory", at: new Date().toISOString() })
            }
          }
          for (const c of s.campaigns) {
            const before = prev.campaigns.find((x) => x.id === c.id)
            if (c.status !== "in_review" || before?.status === "in_review") continue
            // The first submission has a stable key; a resubmission after a withdrawal or rejection is its own event.
            const key = before ? `a:campaign:${c.id}:resubmitted:${Date.now()}` : `a:campaign:${c.id}:submitted`
            push({ eventKey: key, audience: "admin", category: "system_alert", title: `${before ? "Campaign resubmitted" : "Campaign submitted"} for review: ${c.name}`, body: `${brandById.get(c.brandId)?.name ?? "A brand"} submitted a ${c.type.replace(/-/g, " ")} campaign.`, href: "/admin/advertising", at: new Date().toISOString() })
          }
        }),
      )

      // Merchant: a new follower for the Studio brand.
      unsubs.push(
        useSaved.subscribe((s, prev) => {
          if (s.following.includes(STUDIO_BRAND_ID) && !prev.following.includes(STUDIO_BRAND_ID)) {
            push({ eventKey: `m:follower:${Date.now()}`, audience: "merchant", category: "new_follower", title: "New follower", body: "Someone just followed your brand. They'll see your next drop in their feed.", href: "/studio/customers", at: new Date().toISOString() })
          }
        }),
      )

      // Merchant: admin decisions on the Studio brand's payouts and campaigns.
      unsubs.push(
        useAdmin.subscribe((s, prev) => {
          for (const p of s.payouts.filter((p) => p.brandId === STUDIO_BRAND_ID)) {
            const before = prev.payouts.find((x) => x.id === p.id)
            if (before && before.status !== p.status) {
              push({ eventKey: `m:payout:${p.id}:${p.status}:${Date.now()}`, audience: "merchant", category: "payout_status", ...payoutCopy(p), href: "/studio/payouts", at: new Date().toISOString() })
            }
          }
          for (const c of s.campaigns.filter((c) => c.brandId === STUDIO_BRAND_ID)) {
            const before = prev.campaigns.find((x) => x.id === c.id)
            if (!before || before.status === c.status) continue
            if (c.status === "scheduled") {
              // Approved with a future start: one notification per campaign.
              push({ eventKey: `m:campaign:${c.id}:scheduled`, audience: "merchant", category: "campaign_review", title: `Campaign approved: ${c.name}`, body: `It's scheduled to start on ${campaignStart(c)}, always labelled Sponsored.`, href: `/studio/advertising/${c.id}`, at: new Date().toISOString() })
            } else if (c.status === "active" || c.status === "rejected") {
              push({ eventKey: `m:campaign:${c.id}:${c.status}:${Date.now()}`, audience: "merchant", category: "campaign_review", title: c.status === "active" ? `Campaign approved: ${c.name}` : `Campaign rejected: ${c.name}`, body: c.status === "active" ? "It's marked active from today, always labelled Sponsored." : c.rejectionReason ?? "See the reason in Advertising.", href: `/studio/advertising/${c.id}`, at: new Date().toISOString() })
            }
          }
        }),
      )

      // Customer: a drop with a reminder goes live (checked against the demo clock).
      const checkDrops = () => {
        const { notify } = useSaved.getState()
        const now = Date.now()
        const anchor = getDemoAnchor()
        for (const d of drops.filter((d) => notify.includes(d.id))) {
          if (dropPhaseAt(d, now, anchor) === "live") {
            const brand = brandById.get(d.brandId)
            push({ eventKey: `c:drop-live:${d.id}`, audience: "customer", category: "drop_live", ...dropLiveCopy(d, brand?.name ?? "The brand"), href: `/drops/${d.slug}`, at: new Date().toISOString() })
          }
        }
        // Wishlist: a saved product is down to its last few pieces.
        for (const id of useSaved.getState().wishlist) {
          const p = productById.get(id)
          if (!p) continue
          const left = p.variants.reduce((s, v) => s + availableStock(v), 0)
          if (left > 0 && left <= 3) push({ eventKey: `c:wish-low:${id}`, audience: "customer", category: "wishlist_update", title: `Almost gone: ${p.name}`, body: `Only ${left} left of something you saved.`, href: `/products/${p.slug}`, at: new Date().toISOString() })
        }
      }
      checkDrops()
      const timer = window.setInterval(checkDrops, 30_000)
      unsubs.push(() => window.clearInterval(timer))
    }

    // Other tabs: pick up notifications they persisted.
    const onStorage = (e: StorageEvent) => {
      if (e.key === "nocturne-notifications") void useNotifications.persist.rehydrate()
      if (e.key === "nocturne-orders") void useOrders.persist.rehydrate()
      if (e.key === "nocturne-admin") void useAdmin.persist.rehydrate()
      if (e.key === "nocturne-studio") void useStudio.persist.rehydrate()
    }
    window.addEventListener("storage", onStorage)
    unsubs.push(() => window.removeEventListener("storage", onStorage))

    if (ready()) start()
    else {
      const id = window.setInterval(() => {
        if (ready()) {
          window.clearInterval(id)
          start()
        }
      }, 50)
      unsubs.push(() => window.clearInterval(id))
    }
    return () => unsubs.forEach((u) => u())
  }, [])
}
