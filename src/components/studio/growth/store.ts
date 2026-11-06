"use client"

import { useEffect, useSyncExternalStore } from "react"
import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"
import type { Campaign } from "@/lib/data/ads"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import { useStudio } from "@/lib/stores/studio"

/**
 * Growth tools state the shared Studio store doesn't hold yet: promotions (discount codes and
 * automatic sales) and per-drop extras (draft flag, display time zone). Persisted locally for the
 * frontend phase; in the backend phase promotions become a `discounts` table and the drop
 * extras become columns on `drops` (status, display_tz), and this store goes away.
 */

export type PromotionKind = "code" | "automatic"
export type DiscountType = "percentage" | "fixed"
export type PromotionScope = "all" | "collection" | "products"

export type Promotion = {
  id: string
  brandId: string
  kind: PromotionKind
  /** Discount codes only: what shoppers type at checkout. */
  code: string | null
  /** Automatic sales: the name shoppers see on the product and in the bag. Codes: an internal note. */
  title: string
  discountType: DiscountType
  /** Percentage (1–90) or a fixed amount in the brand currency's minor units. */
  value: number
  scope: PromotionScope
  collectionIds: string[]
  productIds: string[]
  /** Calendar dates in the brand's time zone (yyyy-mm-dd), inclusive. */
  startsOn: string
  endsOn: string | null
  usageLimit: number | null
  oncePerCustomer: boolean
  /** Times redeemed. Sample numbers in the frontend phase. */
  used: number
  paused: boolean
  createdAt: string
}

export type DropMeta = {
  draft: boolean
  /** IANA zone the release time was entered in. */
  timeZone: string
  updatedAt: string
}

type GrowthState = {
  promotions: Promotion[]
  dropMeta: Record<string, DropMeta>
  upsertPromotion: (p: Promotion) => void
  removePromotion: (id: string) => void
  setPromotionPaused: (id: string, paused: boolean) => void
  setDropMeta: (id: string, meta: DropMeta) => void
  removeDropMeta: (id: string) => void
}

/** Sample promotions for the signed-in brand (dates fixed so server and client agree). */
const seedPromotions: Promotion[] = [
  {
    id: "promo_static10",
    brandId: STUDIO_BRAND_ID,
    kind: "code",
    code: "STATIC10",
    title: "Followers' code from the Drop 06 newsletter",
    discountType: "percentage",
    value: 10,
    scope: "all",
    collectionIds: [],
    productIds: [],
    startsOn: "2026-10-20",
    endsOn: "2026-12-31",
    usageLimit: 200,
    oncePerCustomer: true,
    used: 46,
    paused: false,
    createdAt: "2026-10-19T10:00:00.000Z",
  },
  {
    id: "promo_mainland",
    brandId: STUDIO_BRAND_ID,
    kind: "code",
    code: "MAINLAND5K",
    title: "Third Mainland launch week",
    discountType: "fixed",
    value: 500_000,
    scope: "products",
    collectionIds: [],
    productIds: ["p_third_mainland_tee"],
    startsOn: "2026-11-20",
    endsOn: "2026-11-27",
    usageLimit: 100,
    oncePerCustomer: true,
    used: 0,
    paused: false,
    createdAt: "2026-11-02T09:00:00.000Z",
  },
  {
    id: "promo_danfo_week",
    brandId: STUDIO_BRAND_ID,
    kind: "automatic",
    code: null,
    title: "Danfo week",
    discountType: "percentage",
    value: 15,
    scope: "collection",
    collectionIds: ["c_ls_drop06"],
    productIds: [],
    startsOn: "2026-09-01",
    endsOn: "2026-09-07",
    usageLimit: null,
    oncePerCustomer: false,
    used: 132,
    paused: false,
    createdAt: "2026-08-28T09:00:00.000Z",
  },
]

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // Storage full or blocked: keep working in memory for this visit.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // ignore
    }
  },
}

export const useGrowth = create<GrowthState>()(
  persist(
    (set, get) => ({
      promotions: seedPromotions,
      dropMeta: {},
      upsertPromotion: (p) => {
        const exists = get().promotions.some((x) => x.id === p.id)
        set({ promotions: exists ? get().promotions.map((x) => (x.id === p.id ? p : x)) : [p, ...get().promotions] })
      },
      removePromotion: (id) => set({ promotions: get().promotions.filter((p) => p.id !== id) }),
      setPromotionPaused: (id, paused) => set({ promotions: get().promotions.map((p) => (p.id === id ? { ...p, paused } : p)) }),
      setDropMeta: (id, meta) => set({ dropMeta: { ...get().dropMeta, [id]: meta } }),
      removeDropMeta: (id) => {
        const next = { ...get().dropMeta }
        delete next[id]
        set({ dropMeta: next })
      },
    }),
    {
      name: "nocturne-studio-growth",
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ promotions, dropMeta }) => ({ promotions, dropMeta }),
      skipHydration: true,
      version: 1,
    },
  ),
)

let growthRehydrateStarted = false

/**
 * True once both the Studio store and the growth store have loaded what this browser saved.
 * Until then pages show skeletons, so saved edits never flash in over sample data, and nothing
 * that depends on the clock renders on the server.
 */
export function useGrowthReady() {
  const studio = useSyncExternalStore(
    (cb) => useStudio.persist.onFinishHydration(cb),
    () => useStudio.persist.hasHydrated(),
    () => false,
  )
  const growth = useSyncExternalStore(
    (cb) => useGrowth.persist.onFinishHydration(cb),
    () => useGrowth.persist.hasHydrated(),
    () => false,
  )
  useEffect(() => {
    if (growthRehydrateStarted) return
    growthRehydrateStarted = true
    void useGrowth.persist.rehydrate()
  }, [])
  return studio && growth
}

/* ---------- Campaign review (Studio ⇄ Admin) ---------- */

/*
 * In this build Studio and the Admin Control Center keep separate copies of a campaign (in the
 * backend phase: one row). The stores keep them in step inside their actions: the Studio store's
 * upsertCampaign puts a submission in the admin review queue and takes a withdrawn one out, and
 * the Admin store's reviewCampaign brings its decision back to the Studio copy. Copies saved
 * before that are brought in step once, by the stores' persist migrations.
 *
 * The helpers below no longer write to either store. They stay only so their remaining callers
 * keep compiling, and can be deleted together with those calls.
 */

/** @deprecated upsertCampaign sends a submission to review. Does nothing. */
export function sendCampaignToReview(c: Campaign) {
  void c
}

/** @deprecated upsertCampaign withdraws a campaign from review. Does nothing. */
export function withdrawCampaignFromReview(id: string) {
  void id
}

/** @deprecated The Admin store's reviewCampaign updates the Studio copy. Does nothing. */
export function useCampaignReviewSync() {}
