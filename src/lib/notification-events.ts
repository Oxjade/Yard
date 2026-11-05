"use client"

import { useEffect } from "react"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"
import { drops } from "@/lib/data/catalog"
import { brandApplications, disputes, failedJobs, moderationQueue, webhookFailures } from "@/lib/data/admin"
import { customerOrders } from "@/lib/data/orders"
import { availableStock, productById } from "@/lib/data/products"
import { daysAgo } from "@/lib/data/seed"
import { dropPhaseAt } from "@/lib/drops"
import { getDemoAnchor } from "@/hooks/use-now"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications, type AppNotification } from "@/lib/stores/notifications"
import { useOrders } from "@/lib/stores/orders"
import { useSaved } from "@/lib/stores/saved"
import { useStudio } from "@/lib/stores/studio"

type New = Omit<AppNotification, "id" | "read"> & { read?: boolean }

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
  if (po) out.push({ eventKey: `m:payout:${po.id}:${po.status}`, audience: "merchant", category: "payout_status", title: `Payout ${po.status.replace("_", " ")}`, body: `${formatMoney(po.amountUsd, "USD")} via ${po.method}.`, href: "/studio/payouts", at: daysAgo(2), sample: true, read: true })
  return out
}

function adminSeed(): New[] {
  const out: New[] = []
  for (const a of brandApplications.filter((a) => a.status === "pending_review" && !a.brandId)) {
    out.push({ eventKey: `a:app:${a.id}`, audience: "admin", category: "merchant_application", title: `New brand application: ${a.brandName}`, body: `${a.category.replace("-", " ")} brand from ${a.country}, ${a.products} products drafted.`, href: "/admin/brands", at: a.submittedAt, sample: true })
  }
  for (const m of moderationQueue.filter((m) => m.status === "open" || m.status === "escalated")) {
    out.push({ eventKey: `a:report:${m.id}`, audience: "admin", category: "product_report", title: `Listing reported: ${m.title}`, body: `${m.brandName}. ${m.detail}`, href: "/admin/products", at: m.reportedAt, sample: true })
  }
  for (const w of webhookFailures) {
    out.push({ eventKey: `a:webhook:${w.id}`, audience: "admin", category: "payment_failure", title: `${w.provider.charAt(0).toUpperCase()}${w.provider.slice(1)} webhook failed`, body: `${w.event}: ${w.reason}`, href: "/admin/health", at: w.receivedAt, sample: true })
  }
  for (const d of disputes.filter((d) => d.type === "chargeback" && d.stage === "needs_evidence")) {
    out.push({ eventKey: `a:cb:${d.id}`, audience: "admin", category: "chargeback", title: `Chargeback opened on #${d.reference}`, body: `${d.brandName}, ${formatMoney(d.amountUsd, "USD")}: ${d.reason}. Evidence due soon.`, href: "/admin/finance", at: d.openedAt, sample: true })
  }
  const risky = brandApplications.find((a) => a.risk === "high" && a.status === "restricted")
  if (risky) out.push({ eventKey: `a:risk:${risky.id}`, audience: "admin", category: "suspicious_activity", title: `High-risk brand: ${risky.brandName}`, body: risky.notes, href: "/admin/brands", at: risky.submittedAt, sample: true, read: true })
  for (const j of failedJobs.slice(0, 1)) {
    out.push({ eventKey: `a:job:${j.id}`, audience: "admin", category: "system_alert", title: `Background job failing: ${j.queue}`, body: `${j.name}: ${j.error}`, href: "/admin/health", at: j.failedAt, sample: true })
  }
  for (const r of useAdmin.getState().refunds.filter((r) => r.status === "requested").slice(0, 3)) {
    out.push({ eventKey: `a:refund:${r.id}`, audience: "admin", category: "refund_request" as AppNotification["category"], title: `Refund requested on #${r.reference}`, body: `${r.brandName}, ${formatMoney(r.amountUsd, "USD")}: ${r.reason}.`, href: "/admin/finance", at: r.requestedAt, sample: true })
  }
  return out
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
      if (!state.seeded.customer) { state.pushMany(customerSeed()); state.setSeeded("customer") }
      if (!state.seeded.merchant) { state.pushMany(merchantSeed()); state.setSeeded("merchant") }
      if (!state.seeded.admin) { state.pushMany(adminSeed()); state.setSeeded("admin") }

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
              if (b === 0 && a > 0) push({ eventKey: `m:oos:${v.id}:${Date.now()}`, audience: "merchant", category: "out_of_stock", title: `${p.name} is out of stock`, body: `${label} just sold out.`, href: "/studio/inventory", at: new Date().toISOString() })
              else if (b > 0 && b <= 3 && a > 3) push({ eventKey: `m:low:${v.id}:${Date.now()}`, audience: "merchant", category: "low_inventory", title: `Low stock: ${p.name}`, body: `${label} has ${b} left.`, href: "/studio/inventory", at: new Date().toISOString() })
            }
          }
          for (const c of s.campaigns) {
            const before = prev.campaigns.find((x) => x.id === c.id)
            if (!before && c.status === "in_review") push({ eventKey: `a:campaign:${c.id}:submitted`, audience: "admin", category: "system_alert", title: `Campaign submitted for review: ${c.name}`, body: `${brandById.get(c.brandId)?.name ?? "A brand"} submitted a ${c.type.replace(/-/g, " ")} campaign.`, href: "/admin/advertising", at: new Date().toISOString() })
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
              push({ eventKey: `m:payout:${p.id}:${p.status}:${Date.now()}`, audience: "merchant", category: "payout_status", title: p.status === "processing" ? "Payout approved, now processing" : p.status === "held" ? "Payout on hold" : `Payout ${p.status.replace("_", " ")}`, body: `${formatMoney(p.amountUsd, "USD")} via ${p.method}. It completes when the provider confirms the transfer.`, href: "/studio/payouts", at: new Date().toISOString() })
            }
          }
          for (const c of s.campaigns.filter((c) => c.brandId === STUDIO_BRAND_ID)) {
            const before = prev.campaigns.find((x) => x.id === c.id)
            if (before && before.status !== c.status && (c.status === "active" || c.status === "rejected")) {
              push({ eventKey: `m:campaign:${c.id}:${c.status}:${Date.now()}`, audience: "merchant", category: "campaign_review", title: c.status === "active" ? `Campaign approved: ${c.name}` : `Campaign rejected: ${c.name}`, body: c.status === "active" ? "It starts serving on its start date, always labelled Sponsored." : c.rejectionReason ?? "See the reason in Advertising.", href: "/studio/advertising", at: new Date().toISOString() })
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
            push({ eventKey: `c:drop-live:${d.id}`, audience: "customer", category: "drop_live", title: `${d.name} is live`, body: `${brand?.name ?? "The brand"} just released it. ${d.unitsLeft} of ${d.totalUnits} left.`, href: `/drops/${d.slug}`, at: new Date().toISOString() })
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
