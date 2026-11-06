"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import { brandById } from "@/lib/data/brands"
import { convert } from "@/lib/money"
import { priceCart } from "@/lib/cart"
import { customerCheckoutGroups, customerOrders } from "@/lib/data/orders"
import { variantLabel } from "@/lib/data/products"
import type { CheckoutGroup, MerchantOrder } from "@/lib/data/types"
import type { CartLine } from "./cart"
import { useAdmin } from "./admin"
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

        const lines = o.lines.filter((l) => request.variantIds.includes(l.variantId))
        const amount = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0)
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
    { name: "nocturne-orders", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
)
