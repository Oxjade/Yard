"use client"

import { useEffect, useSyncExternalStore } from "react"
import { create } from "zustand"
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware"
import { toast } from "sonner"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import type { BrandMark, CategorySlug, StorefrontAccent, StorefrontTemplate, StorefrontTypePreset } from "@/lib/data/types"
import type { SessionUser } from "@/lib/stores/session"

/**
 * Merchant onboarding progress, kept on this device so "Save and finish later" works.
 * Passwords and full account numbers are never stored: the account step signs in through
 * the session, and the payout step keeps only the last four digits. In the backend phase
 * each step becomes a server action that writes the brand, storefront draft and product.
 */

export type StepId = "account" | "brand" | "storefront" | "business" | "product" | "payments" | "publish"

export const STEPS: { id: StepId; label: string; title: string; description: string; minutes: number }[] = [
  { id: "account", label: "Account", title: "Create your account", description: "One account runs your brand and your shopping. It takes a few seconds.", minutes: 0.5 },
  { id: "brand", label: "Brand", title: "Your brand", description: "The name, address and mark shoppers will know you by.", minutes: 1 },
  { id: "storefront", label: "Storefront", title: "Your storefront", description: "Pick a cover, a colour and a template. You can change all of it later.", minutes: 1 },
  { id: "business", label: "Business info", title: "Business info", description: "Where you sell from and how we can reach you. Shoppers never see your contact details.", minutes: 0.5 },
  { id: "product", label: "First product", title: "Add your first product", description: "One product is enough to open. Add the rest from Brand Studio.", minutes: 1 },
  { id: "payments", label: "Payments and shipping", title: "Payments and shipping", description: "How you get paid and how orders reach shoppers.", minutes: 0.5 },
  { id: "publish", label: "Publish", title: "Review and publish", description: "Check your storefront, then put it live.", minutes: 0.5 },
]

export type ImageRef = { src: string; alt: string; source: "library" | "upload" }
export type SizeSystem = "apparel" | "shoes" | "one" | "custom"
export type DeliveryId = "domestic" | "regional" | "international" | "pickup"
export type PayoutMethodId = "bank" | "mobile"

export type OnboardingData = {
  account: { name: string; email: string; provider: SessionUser["provider"] | null }
  brand: {
    name: string
    handle: string
    handleEdited: boolean
    category: CategorySlug | null
    logoMode: "mark" | "upload"
    logo: ImageRef | null
    markText: string
    markEdited: boolean
    markStyle: BrandMark["style"]
    description: string
  }
  storefront: { cover: ImageRef | null; accent: StorefrontAccent; typePreset: StorefrontTypePreset; template: StorefrontTemplate | null; templateEdited: boolean }
  business: {
    country: CountryCode | null
    city: string
    address: string
    currency: CurrencyCode | null
    currencyEdited: boolean
    sellerType: "individual" | "company"
    legalName: string
    contactEmail: string
    phone: string
  }
  product: { images: ImageRef[]; name: string; description: string; price: string; sizeSystem: SizeSystem | null; sizes: { label: string; stock: string }[] }
  payments: {
    method: PayoutMethodId | null
    holder: string
    bankName: string
    /** Only the last four digits are kept, never the full number. */
    accountLast4: string
    accountSaved: boolean
    delivery: DeliveryId[]
    processingMin: string
    processingMax: string
    returnsDays: "14" | "30"
  }
}

export const emptyData: OnboardingData = {
  account: { name: "", email: "", provider: null },
  brand: { name: "", handle: "", handleEdited: false, category: null, logoMode: "mark", logo: null, markText: "", markEdited: false, markStyle: "condensed", description: "" },
  storefront: { cover: null, accent: "violet", typePreset: "condensed", template: null, templateEdited: false },
  business: { country: null, city: "", address: "", currency: null, currencyEdited: false, sellerType: "individual", legalName: "", contactEmail: "", phone: "" },
  product: { images: [], name: "", description: "", price: "", sizeSystem: null, sizes: [] },
  payments: { method: null, holder: "", bankName: "", accountLast4: "", accountSaved: false, delivery: ["domestic"], processingMin: "1", processingMax: "3", returnsDays: "14" },
}

type OnboardingState = {
  step: number
  maxReached: number
  data: OnboardingData
  savedAt: string | null
  publishedAt: string | null
  goTo: (step: number) => void
  next: () => void
  back: () => void
  update: <K extends keyof OnboardingData>(key: K, patch: Partial<OnboardingData[K]>) => void
  markSaved: () => void
  markPublished: () => void
  reset: () => void
}

const last = STEPS.length - 1
const stamp = () => new Date().toISOString()

let warnedQuota = false
/** localStorage that never throws: photos can exceed the quota, so say so once instead of failing. */
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
      if (!warnedQuota) {
        warnedQuota = true
        toast.error("This device is out of space for photos", { description: "Your progress is kept while this tab stays open. Remove a photo or two so it can be saved for later." })
      }
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      /* storage unavailable */
    }
  },
}

export const useOnboarding = create<OnboardingState>()(
  persist(
    (set, get) => ({
      step: 0,
      maxReached: 0,
      data: emptyData,
      savedAt: null,
      publishedAt: null,
      goTo: (step) => set({ step: Math.max(0, Math.min(last, step, get().maxReached)) }),
      next: () => {
        const step = Math.min(last, get().step + 1)
        set({ step, maxReached: Math.max(get().maxReached, step), savedAt: stamp() })
      },
      back: () => set({ step: Math.max(0, get().step - 1) }),
      update: (key, patch) => set({ data: { ...get().data, [key]: { ...get().data[key], ...patch } }, savedAt: stamp() }),
      markSaved: () => set({ savedAt: stamp() }),
      markPublished: () => set({ publishedAt: stamp() }),
      reset: () => set({ step: 0, maxReached: 0, data: emptyData, savedAt: null, publishedAt: null }),
    }),
    {
      name: "nocturne-studio-onboarding",
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ step, maxReached, data, savedAt, publishedAt }) => ({ step, maxReached, data, savedAt, publishedAt }),
      // Merge saved data over the defaults so fields added later are never undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<OnboardingState>
        const data = { ...emptyData } as OnboardingData
        for (const key of Object.keys(emptyData) as (keyof OnboardingData)[]) {
          data[key] = { ...emptyData[key], ...(p.data?.[key] ?? {}) } as never
        }
        return { ...current, ...p, data }
      },
      skipHydration: true,
      version: 1,
    },
  ),
)

let rehydrateStarted = false

/** Loads saved progress after mount, so the server HTML and first client render agree. */
export function useOnboardingHydrated() {
  const hydrated = useSyncExternalStore(
    (cb) => useOnboarding.persist.onFinishHydration(cb),
    () => useOnboarding.persist.hasHydrated(),
    () => false,
  )
  useEffect(() => {
    if (rehydrateStarted) return
    rehydrateStarted = true
    void useOnboarding.persist.rehydrate()
  }, [])
  return hydrated
}
