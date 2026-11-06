"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"
import { drops as allDrops } from "@/lib/data/catalog"
import { campaigns as allCampaigns, type Campaign } from "@/lib/data/ads"
import { customerOrders, merchantOrders } from "@/lib/data/orders"
import { products as allProducts } from "@/lib/data/products"
import type { Drop, MerchantOrder, MerchantOrderStatus, Product, StorefrontConfig } from "@/lib/data/types"
import { readSaved, useAdmin } from "./admin"
import { applyReturnDecision } from "./orders"

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
  /**
   * Saves a campaign. Submitting one (status "in_review") puts it in the platform's review queue
   * and taking one back to draft from review withdraws it, so the Admin store always has what
   * Studio sent (in the backend phase: one row).
   */
  upsertCampaign: (c: Campaign) => void
  /** `patch` carries what travels with the change, such as the reason a brand cancelled. */
  setOrderStatus: (id: string, status: MerchantOrderStatus, label?: string, patch?: Pick<MerchantOrder, "cancelReason">) => void
  /**
   * The brand's decision on a return request: approve (in full, or partly when the shopper
   * returns some of the items) or decline with a reason. Updates this order, the shopper's copy
   * and the platform's refund queue. Returns false when the order isn't waiting for a decision.
   */
  decideReturn: (id: string, status: "approved" | "declined", reason?: string) => boolean
  /** Adds or corrects tracking. The first time on a paid or processing order it also marks the order shipped. */
  setTracking: (id: string, carrier: string, number: string) => void
  saveStorefrontDraft: (draft: StorefrontConfig) => void
  publishStorefront: () => void
  discardStorefrontDraft: () => void
  reset: () => void
}

/**
 * The brand's orders: its sample orders plus the demo shopper's orders with this brand, so an
 * order the shopper sees in their account is the same order the brand fulfils here.
 */
export const studioSeedOrders = [...customerOrders, ...merchantOrders].filter((o) => o.brandId === STUDIO_BRAND_ID).sort((a, b) => b.placedAt.localeCompare(a.placedAt))

function seed() {
  const brand = brandById.get(STUDIO_BRAND_ID)!
  return {
    brandId: STUDIO_BRAND_ID,
    products: allProducts.filter((p) => p.brandId === STUDIO_BRAND_ID),
    drops: allDrops.filter((d) => d.brandId === STUDIO_BRAND_ID),
    campaigns: allCampaigns.filter((c) => c.brandId === STUDIO_BRAND_ID),
    orders: studioSeedOrders,
    inventoryLog: [] as InventoryEvent[],
    storefront: { draft: brand.storefront, published: brand.storefront, publishedAt: null, savedAt: null },
  }
}

const now = () => new Date().toISOString()

/** The sample announcement before v2, which promised an alert for following. */
const OLD_ANNOUNCEMENT = "Drop 07, “Third Mainland”, lands this week. Follow to get the alert."

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
        const before = get().campaigns.find((x) => x.id === c.id)
        set({ campaigns: before ? get().campaigns.map((x) => (x.id === c.id ? c : x)) : [c, ...get().campaigns] })
        // The platform's review copy follows: a submission joins the queue; a withdrawal leaves it.
        const admin = useAdmin.getState()
        if (c.status === "in_review") useAdmin.setState({ campaigns: [c, ...admin.campaigns.filter((x) => x.id !== c.id)] })
        else if (before?.status === "in_review" && c.status === "draft") useAdmin.setState({ campaigns: admin.campaigns.filter((x) => x.id !== c.id || x.status !== "in_review") })
      },
      setOrderStatus: (id, status, label, patch) =>
        set({
          orders: get().orders.map((o) => {
            if (o.id !== id) return o
            // Money that was taken goes back on a cancel or refund; an unpaid order simply closes.
            const taken = o.paymentStatus === "captured" || o.paymentStatus === "authorized" || o.paymentStatus === "partially_refunded"
            const paymentStatus = (status === "refunded" || status === "cancelled") && taken ? "refunded" : o.paymentStatus
            return { ...o, ...patch, status, paymentStatus, timeline: [...o.timeline, { at: now(), label: label ?? `Status changed to ${status.replace(/_/g, " ")}` }] }
          }),
        }),
      decideReturn: (id, status, reason) => !!applyReturnDecision(id, { status, reason, by: "brand" }),
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
      version: 3,
      // v2: the brand's orders include the demo shopper's orders with it, and the sample
      // announcement no longer promises an alert for following (it points at the drop's reminder).
      // v3: a platform decision saved before the stores kept each other in step reaches the
      // brand's copy of the campaign.
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<StudioState>
        const next = { ...p }
        const decided = readSaved<{ campaigns: Campaign[] }>("nocturne-admin")?.campaigns
        if (p.campaigns && decided) {
          next.campaigns = p.campaigns.map((c) => {
            const a = decided.find((x) => x.id === c.id)
            return c.status === "in_review" && a && a.status !== "in_review" && a.status !== "draft" ? { ...c, status: a.status, rejectionReason: a.status === "rejected" ? a.rejectionReason : undefined } : c
          })
        }
        if (p.orders) {
          const known = new Set(p.orders.map((o) => o.id))
          const missing = customerOrders.filter((o) => o.brandId === (p.brandId ?? STUDIO_BRAND_ID) && !known.has(o.id))
          next.orders = [...p.orders, ...missing].sort((a, b) => b.placedAt.localeCompare(a.placedAt))
        }
        if (p.storefront) {
          const fresh = brandById.get(p.brandId ?? STUDIO_BRAND_ID)?.storefront.announcement
          const fix = (c: StorefrontConfig): StorefrontConfig => (c.announcement?.text === OLD_ANNOUNCEMENT && fresh ? { ...c, announcement: fresh } : c)
          next.storefront = { ...p.storefront, draft: fix(p.storefront.draft), published: fix(p.storefront.published) }
        }
        return next as StudioState
      },
    },
  ),
)
