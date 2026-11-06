"use client"

import { useEffect, useSyncExternalStore } from "react"
import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"
import { freeShippingThresholdUsd, shippingRatesUsd, type CountryCode, type CurrencyCode, type ShippingZone } from "@/config/markets"
import { STUDIO_BRAND_ID, brandById } from "@/lib/data/brands"
import type { CategorySlug } from "@/lib/data/types"
import { convert } from "@/lib/money"

/**
 * Brand settings the shared Studio store doesn't hold yet: profile edits, payout account,
 * shipping, returns and team. Persisted locally for the frontend phase; in the backend phase
 * these become `brands`, `merchant_payout_accounts`, `shipping_profiles`, `brand_policies` and
 * `brand_members`, written by server actions with authorization, and this store goes away.
 */

export type ProfileSettings = {
  name: string
  handle: string
  category: CategorySlug
  description: string
  city: string
  country: CountryCode
  currency: CurrencyCode
}

export type PayoutProvider = "paystack" | "flutterwave" | "bank_transfer"
export type PayoutSchedule = "weekly" | "biweekly" | "monthly"

export type PayoutAccount = {
  provider: PayoutProvider
  country: CountryCode
  bankName: string
  accountName: string
  last4: string
  status: "verified" | "pending"
  changedAt: string | null
}

export type ZoneSetting = { zone: ShippingZone; enabled: boolean; standard: number; express: number | null }

export type ShippingSettings = {
  processingDays: [number, number]
  zones: ZoneSetting[]
  freeShipping: { enabled: boolean; threshold: number }
}

export type ReturnsSettings = {
  accepts: boolean
  windowDays: number
  returnShipping: "customer" | "brand"
  dropsFinalSale: boolean
  conditions: string
}

export type TeamRole = "owner" | "admin" | "designer" | "fulfilment" | "finance" | "viewer"
export type TeamMember = { id: string; name: string | null; email: string; role: TeamRole; status: "active" | "invited"; addedAt: string }

export type SettingsSection = "profile" | "payouts" | "shipping" | "returns" | "team"

type SettingsState = {
  profile: ProfileSettings
  payout: { account: PayoutAccount; schedule: PayoutSchedule }
  shipping: ShippingSettings
  returns: ReturnsSettings
  team: TeamMember[]
  savedAt: Partial<Record<SettingsSection, string>>
  saveProfile: (p: ProfileSettings) => void
  saveSchedule: (s: PayoutSchedule) => void
  saveAccount: (a: Omit<PayoutAccount, "status" | "changedAt">) => void
  revertAccount: () => void
  saveShipping: (s: ShippingSettings) => void
  saveReturns: (r: ReturnsSettings) => void
  invite: (email: string, role: TeamRole) => void
  setRole: (id: string, role: TeamRole) => void
  removeMember: (id: string) => void
}

/**
 * The payout account on file with the platform: what the Payouts page pays into. A change saved
 * here stays pending until the backend is connected and the provider verifies it.
 */
export function accountOnFile(): PayoutAccount {
  const b = brandById.get(STUDIO_BRAND_ID)!
  const local = b.country === "NG" || b.country === "GH" || b.country === "KE"
  return { provider: local ? "paystack" : "bank_transfer", country: b.country, bankName: b.country === "NG" ? "GTBank" : "Bank", accountName: `${b.name.toUpperCase()} STUDIO LTD`, last4: "4821", status: "verified", changedAt: null }
}

/** The brand profile as the rest of Studio and the storefront read it today. */
export function liveProfile(): ProfileSettings {
  const b = brandById.get(STUDIO_BRAND_ID)!
  return { name: b.name, handle: b.handle, category: b.categories[0], description: b.description, city: b.city, country: b.country, currency: b.currency }
}

function seed() {
  const b = brandById.get(STUDIO_BRAND_ID)!
  const rate = (usd: number) => convert(usd, "USD", b.currency)
  const zones: ShippingZone[] = ["domestic", "regional", "international"]
  return {
    profile: liveProfile(),
    payout: {
      account: accountOnFile(),
      schedule: "weekly" as PayoutSchedule,
    },
    shipping: {
      processingDays: b.processingDays,
      zones: zones.map((zone) => ({ zone, enabled: true, standard: rate(shippingRatesUsd[zone].standard), express: rate(shippingRatesUsd[zone].express) })),
      freeShipping: { enabled: true, threshold: rate(freeShippingThresholdUsd) },
    } as ShippingSettings,
    returns: {
      accepts: true,
      windowDays: b.returnsDays,
      returnShipping: "customer",
      dropsFinalSale: true,
      conditions: "Unworn, unwashed and with the swing tag attached. Pack it in the original mailer if you still have it.",
    } as ReturnsSettings,
    team: [
      { id: "tm_owner", name: b.founder.name, email: `${b.founder.name.split(" ")[0].toLowerCase()}@${b.handle.replace(/-/g, "")}.example`, role: "owner", status: "active", addedAt: b.joinedAt },
      { id: "tm_kemi", name: "Kemi Balogun", email: `kemi@${b.handle.replace(/-/g, "")}.example`, role: "fulfilment", status: "active", addedAt: "2026-05-14" },
    ] as TeamMember[],
    savedAt: {},
  }
}

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

const stamp = () => new Date().toISOString()

export const useBrandSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...seed(),
      saveProfile: (profile) => {
        const from = get().profile.currency
        const shipping = get().shipping
        // Shipping amounts are stored in the brand currency, so a currency change converts them.
        const conv = (n: number) => convert(n, from, profile.currency)
        set({
          profile,
          shipping:
            from === profile.currency
              ? shipping
              : { ...shipping, zones: shipping.zones.map((z) => ({ ...z, standard: conv(z.standard), express: z.express === null ? null : conv(z.express) })), freeShipping: { ...shipping.freeShipping, threshold: conv(shipping.freeShipping.threshold) } },
          savedAt: { ...get().savedAt, profile: stamp() },
        })
      },
      saveSchedule: (schedule) => set({ payout: { ...get().payout, schedule }, savedAt: { ...get().savedAt, payouts: stamp() } }),
      saveAccount: (a) => set({ payout: { ...get().payout, account: { ...a, status: "pending", changedAt: stamp() } }, savedAt: { ...get().savedAt, payouts: stamp() } }),
      revertAccount: () => set({ payout: { ...get().payout, account: accountOnFile() }, savedAt: { ...get().savedAt, payouts: stamp() } }),
      saveShipping: (shipping) => set({ shipping, savedAt: { ...get().savedAt, shipping: stamp() } }),
      saveReturns: (returns) => set({ returns, savedAt: { ...get().savedAt, returns: stamp() } }),
      invite: (email, role) =>
        set({
          team: [...get().team, { id: `tm_${Date.now().toString(36)}`, name: null, email: email.trim().toLowerCase(), role, status: "invited", addedAt: stamp() }],
          savedAt: { ...get().savedAt, team: stamp() },
        }),
      setRole: (id, role) => set({ team: get().team.map((m) => (m.id === id && m.role !== "owner" ? { ...m, role } : m)), savedAt: { ...get().savedAt, team: stamp() } }),
      removeMember: (id) => set({ team: get().team.filter((m) => m.id !== id || m.role === "owner"), savedAt: { ...get().savedAt, team: stamp() } }),
    }),
    {
      name: "nocturne-studio-settings",
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ profile, payout, shipping, returns, team, savedAt }) => ({ profile, payout, shipping, returns, team, savedAt }),
      skipHydration: true,
      version: 1,
    },
  ),
)

let rehydrateStarted = false

/** True once saved settings have loaded; until then the page shows skeletons so saved values never flash in. */
export function useSettingsReady() {
  const ready = useSyncExternalStore(
    (cb) => useBrandSettings.persist.onFinishHydration(cb),
    () => useBrandSettings.persist.hasHydrated(),
    () => false,
  )
  useEffect(() => {
    if (rehydrateStarted) return
    rehydrateStarted = true
    void useBrandSettings.persist.rehydrate()
  }, [])
  return ready
}
