"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"
import { drops as allDrops } from "@/lib/data/catalog"
import { campaigns as allCampaigns, type Campaign } from "@/lib/data/ads"
import { merchantOrders } from "@/lib/data/orders"
import { products as allProducts } from "@/lib/data/products"
import type { Drop, MerchantOrder, MerchantOrderStatus, Product, StorefrontConfig } from "@/lib/data/types"

/**
 * Brand Studio state for the frontend phase. Seeded from the sample data for the signed-in
 * brand and persisted locally, so every form and action in Studio really works. In the
 * backend phase each action becomes a server action with authorization and validation;
 * the shapes stay the same.
 */

export type InventoryEvent = { id: string; at: string; variantId: string; productId: string; delta: number; reason: "received" | "adjustment" | "sale" | "return" | "damaged" | "reservation"; note?: string }

type StudioState = {
  brandId: string
  products: Product[]
  drops: Drop[]
  campaigns: Campaign[]
  orders: MerchantOrder[]
  inventoryLog: InventoryEvent[]
  storefront: { draft: StorefrontConfig; published: StorefrontConfig; publishedAt: string | null; savedAt: string | null }
  upsertProduct: (p: Product) => void
  /** Refuses (returns false) when the product has orders: archive it instead, so order history keeps its product. */
  removeProduct: (id: string) => boolean
  setProductStatus: (id: string, status: Product["status"]) => void
  adjustStock: (productId: string, variantId: string, delta: number, reason: InventoryEvent["reason"], note?: string) => void
  upsertDrop: (d: Drop) => void
  removeDrop: (id: string) => void
  upsertCampaign: (c: Campaign) => void
  setOrderStatus: (id: string, status: MerchantOrderStatus, label?: string) => void
  /** Adds or corrects tracking. The first time on a paid or processing order it also marks the order shipped. */
  setTracking: (id: string, carrier: string, number: string) => void
  saveStorefrontDraft: (draft: StorefrontConfig) => void
  publishStorefront: () => void
  discardStorefrontDraft: () => void
  reset: () => void
}

function seed() {
  const brand = brandById.get(STUDIO_BRAND_ID)!
  return {
    brandId: STUDIO_BRAND_ID,
    products: allProducts.filter((p) => p.brandId === STUDIO_BRAND_ID),
    drops: allDrops.filter((d) => d.brandId === STUDIO_BRAND_ID),
    campaigns: allCampaigns.filter((c) => c.brandId === STUDIO_BRAND_ID),
    orders: merchantOrders.filter((o) => o.brandId === STUDIO_BRAND_ID),
    inventoryLog: [] as InventoryEvent[],
    storefront: { draft: brand.storefront, published: brand.storefront, publishedAt: null, savedAt: null },
  }
}

const now = () => new Date().toISOString()

export const useStudio = create<StudioState>()(
  persist(
    (set, get) => ({
      ...seed(),
      upsertProduct: (p) => {
        const exists = get().products.some((x) => x.id === p.id)
        set({ products: exists ? get().products.map((x) => (x.id === p.id ? p : x)) : [p, ...get().products] })
      },
      removeProduct: (id) => {
        if (get().orders.some((o) => o.lines.some((l) => l.productId === id))) return false
        set({ products: get().products.filter((p) => p.id !== id) })
        return true
      },
      setProductStatus: (id, status) => set({ products: get().products.map((p) => (p.id === id ? { ...p, status } : p)) }),
      adjustStock: (productId, variantId, delta, reason, note) =>
        set({
          products: get().products.map((p) =>
            p.id !== productId ? p : { ...p, variants: p.variants.map((v) => (v.id === variantId ? { ...v, stock: Math.max(0, v.stock + delta) } : v)) },
          ),
          inventoryLog: [{ id: `ie_${get().inventoryLog.length + 1}_${Date.now()}`, at: now(), productId, variantId, delta, reason, note }, ...get().inventoryLog],
        }),
      upsertDrop: (d) => {
        const exists = get().drops.some((x) => x.id === d.id)
        set({ drops: exists ? get().drops.map((x) => (x.id === d.id ? d : x)) : [d, ...get().drops] })
      },
      removeDrop: (id) => set({ drops: get().drops.filter((d) => d.id !== id) }),
      upsertCampaign: (c) => {
        const exists = get().campaigns.some((x) => x.id === c.id)
        set({ campaigns: exists ? get().campaigns.map((x) => (x.id === c.id ? c : x)) : [c, ...get().campaigns] })
      },
      setOrderStatus: (id, status, label) =>
        set({
          orders: get().orders.map((o) => {
            if (o.id !== id) return o
            // Money that was taken goes back on a cancel or refund; an unpaid order simply closes.
            const taken = o.paymentStatus === "captured" || o.paymentStatus === "authorized" || o.paymentStatus === "partially_refunded"
            const paymentStatus = (status === "refunded" || status === "cancelled") && taken ? "refunded" : o.paymentStatus
            return { ...o, status, paymentStatus, timeline: [...o.timeline, { at: now(), label: label ?? `Status changed to ${status.replace(/_/g, " ")}` }] }
          }),
        }),
      setTracking: (id, carrier, number) =>
        set({
          orders: get().orders.map((o) =>
            o.id !== id
              ? o
              : {
                  ...o,
                  tracking: { carrier, number },
                  status: o.status === "processing" || o.status === "paid" ? "shipped" : o.status,
                  timeline: [...o.timeline, { at: now(), label: o.tracking ? `Tracking updated: ${carrier}, ${number}` : `Shipped with ${carrier}, tracking ${number}` }],
                },
          ),
        }),
      saveStorefrontDraft: (draft) => set({ storefront: { ...get().storefront, draft, savedAt: now() } }),
      publishStorefront: () => set({ storefront: { ...get().storefront, published: get().storefront.draft, publishedAt: now() } }),
      discardStorefrontDraft: () => set({ storefront: { ...get().storefront, draft: get().storefront.published, savedAt: null } }),
      reset: () => set(seed()),
    }),
    {
      name: "nocturne-studio",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      version: 1,
    },
  ),
)
