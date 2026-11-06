"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import { site } from "@/config/site"
import { brandById } from "@/lib/data/brands"
import { convert, formatMoney } from "@/lib/money"
import { priceCart } from "@/lib/cart"
import { customerCheckoutGroups, customerOrders, sampleReturnRequest } from "@/lib/data/orders"
import { variantLabel } from "@/lib/data/products"
import type { CheckoutGroup, MerchantOrder, ReturnDecision } from "@/lib/data/types"
import { returnRefund } from "@/lib/payouts"
import type { CartLine } from "./cart"
import { useAdmin } from "./admin"
import { renameTimeline } from "./old-name"
import { useStudio } from "./studio"

/**
 * The shopper's orders in the frontend phase. `placeCheckout` mirrors what the backend
 * will do: one checkout group, one merchant order per brand, guarded by an idempotency key
 * so a double submit never creates two orders. Orders are created unpaid ("pending_payment")
 * and only a verified provider webhook may mark them paid — there is no provider in this
 * build, so they stay unpaid. In the backend phase this becomes a server action that
 * re-prices, reserves stock atomically and starts payment with the provider.
 */

export type CheckoutInput = {
  idempotencyKey: string
  lines: CartLine[]
  currency: CurrencyCode
  shipTo: CountryCode
  contact: { name: string; email: string; phone?: string }
  address: { line1: string; city: string; postcode?: string; country: CountryCode }
  /** brandId → shipping method label */
  shipping: Record<string, "standard" | "express">
  paymentMethod: "card" | "bank_transfer" | "ussd" | "mobile_money"
}

type OrdersState = {
  groups: CheckoutGroup[]
  orders: MerchantOrder[]
  processedKeys: Record<string, string>
  placeCheckout: (input: CheckoutInput) => { groupId: string; duplicate: boolean }
  /**
   * A return request on a delivered order. It lands on the brand's order in Studio and in the
   * admin refund queue (in the backend phase: one row both read). Returns false when the order
   * can't take a request (not delivered, or already requested).
   */
  requestReturn: (orderId: string, request: { reason: string; reasonLabel: string; note?: string; variantIds: string[] }) => boolean
}

let seq = 0

export const useOrders = create<OrdersState>()(
  persist(
    (set, get) => ({
      groups: customerCheckoutGroups,
      orders: customerOrders,
      processedKeys: {},
      placeCheckout: (input) => {
        const existing = get().processedKeys[input.idempotencyKey]
        if (existing) return { groupId: existing, duplicate: true }
        const bag = priceCart(input.lines, input.shipTo, input.currency)
        const at = new Date().toISOString()
        seq += 1
        const groupId = `cg_${Date.now().toString(36)}${seq}`
        const reference = `NCT-${Date.now().toString(36).slice(-4).toUpperCase()}-${String(seq).padStart(2, "0")}`
        const orders: MerchantOrder[] = bag.groups.map((g, i) => {
          const express = input.shipping[g.brand.id] === "express"
          const shipping = express ? Math.round(g.shipping * 1.9) || Math.round(g.subtotal * 0.04) : g.shipping
          return {
            id: `mo_${groupId}_${i}`,
            reference: `${reference}-${i + 1}`,
            groupId,
            brandId: g.brand.id,
            customerId: "u_ada",
            // Never "paid" until the payment provider confirms it server-side (backend phase).
            status: "pending_payment",
            paymentStatus: "pending",
            currency: input.currency,
            lines: g.lines.map((l) => ({ productId: l.product.id, variantId: l.variant.id, name: l.product.name, variantLabel: variantLabel(l.variant.options), image: l.product.images[0], quantity: l.line.quantity, unitPrice: l.unit })),
            subtotal: g.subtotal,
            shipping,
            tax: 0,
            total: g.subtotal + shipping,
            commission: Math.round(g.subtotal * 0.05),
            placedAt: at,
            shippingAddress: { name: input.contact.name, line1: input.address.line1, city: input.address.city, country: input.address.country, postcode: input.address.postcode, phone: input.contact.phone },
            shippingMethod: express ? "Express" : "Standard",
            timeline: [
              { at, label: "Order placed" },
              { at, label: "Waiting for the payment provider to confirm. No provider is connected in this development build, so this order stays unpaid." },
            ],
          }
        })
        const group: CheckoutGroup = { id: groupId, reference, customerId: "u_ada", placedAt: at, currency: input.currency, orderIds: orders.map((o) => o.id), total: orders.reduce((s, o) => s + o.total, 0) }
        set({ groups: [group, ...get().groups], orders: [...orders, ...get().orders], processedKeys: { ...get().processedKeys, [input.idempotencyKey]: groupId } })
        // The merchant sees their order immediately (in the backend phase: the same database row).
        const studio = useStudio.getState()
        const mine = orders.filter((o) => o.brandId === studio.brandId)
        if (mine.length) useStudio.setState({ orders: [...mine, ...studio.orders] })
        return { groupId, duplicate: false }
      },
      requestReturn: (orderId, request) => {
        const o = get().orders.find((x) => x.id === orderId)
        if (!o || o.status !== "delivered" || o.returnRequest) return false
        const at = new Date().toISOString()
        const returnRequest = { at, ...request }
        const entry = { at, label: `Return requested: ${request.reasonLabel.toLowerCase()}` }
        const next: MerchantOrder = { ...o, status: "refund_requested", returnRequest, timeline: [...o.timeline, entry] }
        set({ orders: get().orders.map((x) => (x.id === orderId ? next : x)) })

        const studio = useStudio.getState()
        if (o.brandId === studio.brandId) {
          const known = studio.orders.some((x) => x.id === orderId)
          useStudio.setState({
            orders: known ? studio.orders.map((x) => (x.id === orderId ? { ...x, status: "refund_requested", returnRequest, timeline: [...x.timeline, entry] } : x)) : [next, ...studio.orders],
          })
        }

        // The same refund the brand sees: the returned items, or what was paid when it's everything.
        const amount = returnRefund(o, request.variantIds).amount
        const admin = useAdmin.getState()
        const id = `rf_${orderId}`
        useAdmin.setState({
          refunds: [
            { id, reference: o.reference, brandName: brandById.get(o.brandId)?.name ?? "Brand", customer: o.shippingAddress.name, amountUsd: convert(amount, o.currency, "USD"), reason: request.reasonLabel, requestedAt: at, status: "requested", idempotencyKey: `rfnd_${orderId}` },
            ...admin.refunds.filter((r) => r.id !== id),
          ],
        })
        return true
      },
    }),
    {
      name: "nocturne-orders",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
      // v1: decisions saved on an order's timeline before the platform was renamed read its
      // current name ("approved by Yard").
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<OrdersState>
        return (p.orders ? { ...p, orders: p.orders.map(renameTimeline) } : p) as OrdersState
      },
    },
  ),
)

/* ---------- Decisions on return requests ---------- */

export type ReturnDecisionInput = {
  status: "approved" | "declined"
  /** A decline's reason, shown to the shopper. An approval's reason stays with whoever recorded it. */
  reason?: string
  by: ReturnDecision["by"]
  /** For a platform decision: the audit entry it wrote. */
  ref?: string
}

/**
 * Records a decision on a return request on every copy of the order: the brand's (Studio), the
 * shopper's, and, for the brand's own decisions, the platform's refund queue (a platform decision
 * is made there, by setRefundStatus). In the backend phase this is one server action on one row.
 *
 * An approval is recorded, never sent: no payment provider is connected in this build. Returning
 * part of an order keeps it delivered with payment "partially_refunded" and the refund on the
 * order; returning all of it marks it refunded. A decline puts it back to delivered with the
 * reason. Returns the decided order, or null when no copy is waiting for a decision.
 */
export function applyReturnDecision(orderId: string, input: ReturnDecisionInput): MerchantOrder | null {
  const studio = useStudio.getState()
  const theirs = useOrders.getState().orders.find((x) => x.id === orderId)
  const brands = studio.orders.find((x) => x.id === orderId)
  const waiting = (o?: MerchantOrder) => (o?.status === "refund_requested" ? o : undefined)
  const base = waiting(theirs) ?? waiting(brands)
  if (!base) return null

  const at = new Date().toISOString()
  const brandName = brandById.get(base.brandId)?.name ?? "The brand"
  const who = input.by === "brand" ? brandName : site.name
  // A sample order that came with a return requested has no request record: it gets the one
  // Studio and Finance show for it (the whole order), so the decision is recorded like any other.
  const request = base.returnRequest ?? sampleReturnRequest(base)
  const refund = returnRefund(base, request.variantIds)
  const approved = input.status === "approved"
  const reason = input.reason?.trim().replace(/\.$/, "")
  const decision: ReturnDecision = approved
    ? { status: "approved", at, by: input.by, amount: refund.amount, partial: refund.partial, ref: input.ref }
    : { status: "declined", at, by: input.by, reason: reason || undefined, ref: input.ref }
  const items = refund.units === 1 ? "1 item" : `${refund.units} items`
  const label = approved
    ? `${refund.partial ? "Partial refund" : "Refund"} of ${formatMoney(refund.amount, base.currency)} approved by ${who}${refund.partial ? ` for ${items}` : ""}. Recorded; not sent, as no payment provider is connected`
    : `Return declined by ${who}${reason ? `: ${reason}` : ""}`

  const decide = (o: MerchantOrder): MerchantOrder => {
    const taken = o.paymentStatus === "captured" || o.paymentStatus === "authorized" || o.paymentStatus === "partially_refunded"
    const returnRequest = { ...(o.returnRequest ?? request), decision }
    const timeline = [...o.timeline, { at, label }]
    if (!approved) return { ...o, status: "delivered", returnRequest, timeline }
    const recorded = { amount: refund.amount, variantIds: refund.variantIds, at }
    if (refund.partial) return { ...o, status: "delivered", paymentStatus: taken ? "partially_refunded" : o.paymentStatus, returnRequest, refund: recorded, timeline }
    return { ...o, status: "refunded", paymentStatus: taken ? "refunded" : o.paymentStatus, returnRequest, refund: recorded, timeline }
  }

  // The shopper's copy first, then the brand's: the brand's store events copy its order onto the
  // shopper's, which is then already in step.
  let decided: MerchantOrder | null = null
  if (waiting(theirs)) {
    decided = decide(theirs!)
    useOrders.setState({ orders: useOrders.getState().orders.map((x) => (x.id === orderId ? decided! : x)) })
  }
  if (waiting(brands)) {
    const next = decide(brands!)
    decided ??= next
    useStudio.setState({ orders: useStudio.getState().orders.map((x) => (x.id === orderId ? next : x)) })
  }

  // The brand's decision reaches the platform's refund queue (no admin audit entry in the brand's name).
  if (input.by === "brand") {
    const id = `rf_${orderId}`
    const admin = useAdmin.getState()
    if (admin.refunds.some((r) => r.id === id && r.status === "requested")) useAdmin.setState({ refunds: admin.refunds.map((r) => (r.id === id ? { ...r, status: input.status } : r)) })
  }
  return decided
}
