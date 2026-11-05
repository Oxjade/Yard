"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import { priceCart } from "@/lib/cart"
import { customerCheckoutGroups, customerOrders } from "@/lib/data/orders"
import { variantLabel } from "@/lib/data/products"
import type { CheckoutGroup, MerchantOrder } from "@/lib/data/types"
import type { CartLine } from "./cart"

/**
 * The shopper's orders in the frontend phase. `placeCheckout` mirrors what the backend
 * will do: one checkout group, one merchant order per brand, guarded by an idempotency key
 * so a double submit never creates two orders. In the backend phase this becomes a server
 * action that re-prices, reserves stock atomically and starts payment with the provider.
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
            status: "paid",
            paymentStatus: "captured",
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
              { at, label: "Payment confirmed by provider (development simulation)" },
            ],
          }
        })
        const group: CheckoutGroup = { id: groupId, reference, customerId: "u_ada", placedAt: at, currency: input.currency, orderIds: orders.map((o) => o.id), total: orders.reduce((s, o) => s + o.total, 0) }
        set({ groups: [group, ...get().groups], orders: [...orders, ...get().orders], processedKeys: { ...get().processedKeys, [input.idempotencyKey]: groupId } })
        return { groupId, duplicate: false }
      },
    }),
    { name: "nocturne-orders", storage: createJSONStorage(() => localStorage), skipHydration: true },
  ),
)
