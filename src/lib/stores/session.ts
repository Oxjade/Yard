"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { toast } from "sonner"
import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import type { DemoSignInResult, ShopperProfile } from "@/lib/api/contracts/session"
import type { Aesthetic, CategorySlug } from "@/lib/data/types"
import { afterIdentityChange } from "@/lib/session/identity"
import { clearOnboardingAuthReturn } from "@/lib/session/auth-return"
import { useCart } from "./cart"

/**
 * The marketplace session in this browser. Guests can browse everything; following, saving and
 * buying ask them to sign in first (blueprint §8.1). In v2 the identity itself lives on the
 * server: password sign-in or demo sign-in opens the server session, and the local user is set
 * from its profile; signing out ends the server session first. SessionSync keeps the two in step,
 * and other tabs follow through the persisted state.
 */

export type SessionUser = {
  id: string
  name: string
  email: string
  provider: "google" | "apple" | "auth0" | "email"
}

export type PasswordSignInResult =
  | { status: "signed_in"; actor: "shopper"; profile: ShopperProfile }
  | { status: "verify_email" }

export type NotificationPrefs = {
  newProducts: boolean
  drops: boolean
  collections: boolean
  promotions: boolean
  email: boolean
  push: boolean
}

export type AuthIntent = "follow" | "save" | "notify" | "checkout" | "account" | "message" | "report"

/** The one demo shopper the marketplace signs in as: this browser's orders, saves and bag aren't per-account (§2.3). */
export const DEMO_SHOPPER = "u_ada"

type SessionState = {
  user: SessionUser | null
  currency: CurrencyCode
  /**
   * True once the shopper picked a currency themselves. Until then the currency follows the
   * delivery country (Nigeria → NGN), wherever the country changes.
   */
  currencyChosen: boolean
  shipTo: CountryCode
  /** True once the shopper picked a delivery country; until then it follows where they visit from. */
  shipToChosen?: boolean
  /** The delivery city chosen with the destination picker (optional; never a precise location). */
  shipToCity: string | null
  interests: CategorySlug[]
  aesthetics: Aesthetic[]
  onboarded: boolean
  notifications: NotificationPrefs
  /** The action a guest attempted, which opens the sign-in prompt. */
  authPrompt: { intent: AuthIntent; then?: () => void } | null
  /** True while a server sign-in or sign-out is in flight, so SessionSync waits for it. */
  serverPending: boolean
  /**
   * When this browser last signed out (ISO), until the next sign-in. Persisted, so no tab adopts
   * or restores a server session after the shopper signed out (SessionSync).
   */
  signedOutAt: string | null
  signIn: (user: SessionUser) => void
  signInWithPassword: (email: string, password: string) => Promise<PasswordSignInResult>
  /**
   * Signs in on the server as the demo shopper (Ada) and then locally from the server's profile,
   * finishing any pending prompt action. `keepProfile` keeps the local name and email instead
   * (Studio onboarding, where the owner typed their own). Throws an ApiError when the server refuses.
   */
  signInDemo: (provider: SessionUser["provider"], opts?: { keepProfile?: { name: string; email: string } }) => Promise<SessionUser>
  /** Change the signed-in shopper's name and email (this browser only). */
  updateProfile: (details: { name: string; email: string }) => void
  /**
   * Ends the server session, then the local one. Resolves true once the server confirmed; on a
   * failure the shopper stays signed in, a toast says so, and it resolves false. Callers show
   * "Signed out" only after `true`.
   */
  signOut: () => Promise<boolean>
  /** The shopper's own choice: from now on the currency no longer follows the country. */
  setCurrency: (c: CurrencyCode) => void
  /** Changes the delivery country; the currency follows it unless the shopper chose one. */
  setShipTo: (c: CountryCode) => void
  /** The visitor's country (from their connection): applied only while they haven't chosen one. */
  detectShipTo: (c: CountryCode) => void
  setShipToCity: (city: string | null) => void
  setInterests: (interests: CategorySlug[], aesthetics: Aesthetic[]) => void
  finishOnboarding: () => void
  setNotifications: (p: Partial<NotificationPrefs>) => void
  requireAuth: (intent: AuthIntent, then?: () => void) => boolean
  dismissAuthPrompt: () => void
}

/** The currency a delivery country pays in (Nigeria → NGN). */
const countryCurrency = (c: CountryCode) => (countries[c]?.currency ?? "NGN") as CurrencyCode

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      currency: "NGN",
      currencyChosen: false,
      shipTo: "NG",
      shipToCity: null,
      interests: [],
      aesthetics: [],
      onboarded: false,
      notifications: {
        newProducts: true,
        drops: true,
        collections: true,
        promotions: false,
        email: true,
        push: false,
      },
      authPrompt: null,
      serverPending: false,
      signedOutAt: null,
      signIn: (user) => {
        const pending = get().authPrompt?.then
        set({ user, authPrompt: null, signedOutAt: null })
        pending?.()
      },
      signInWithPassword: async (email, password) => {
        set({ serverPending: true })
        try {
          const result = await api<PasswordSignInResult>("/api/auth/sign-in", { body: { actor: "shopper", email, password } })
          if (result.status === "signed_in") {
            await afterIdentityChange("market")
            get().signIn({ id: result.profile.id, name: result.profile.name, email: result.profile.email, provider: "email" })
          }
          return result
        } finally {
          set({ serverPending: false })
        }
      },
      signInDemo: async (provider, opts) => {
        set({ serverPending: true })
        try {
          const r = await api<DemoSignInResult>("/api/auth/demo", { body: { actor: "shopper", account: DEMO_SHOPPER } })
          await afterIdentityChange("market")
          const p = r.profile as ShopperProfile
          const profile = opts?.keepProfile ?? { name: p.name, email: p.email }
          const user: SessionUser = { id: p.id, name: profile.name, email: profile.email, provider }
          get().signIn(user)
          return user
        } finally {
          set({ serverPending: false })
        }
      },
      updateProfile: ({ name, email }) => {
        const user = get().user
        if (user) set({ user: { ...user, name, email } })
      },
      signOut: async () => {
        if (get().serverPending) return false
        // The server first: a sign-out that didn't reach it would be restored by SessionSync, so
        // the local user only goes once the server confirms.
        set({ serverPending: true })
        try {
          await api("/api/auth/demo", { method: "DELETE", query: { actor: "shopper" } })
        } catch {
          set({ serverPending: false })
          toast.error("Couldn't sign out. Check your connection and try again.")
          return false
        }
        set({ user: null, signedOutAt: new Date().toISOString(), authPrompt: null })
        clearOnboardingAuthReturn()
        // The bag empties with the account (the shopper's server cart is kept for their next
        // sign-in); Providers then loads this browser's guest cart once the session store follows.
        void useCart.getState().syncFromServer({ reset: true })
        try {
          await afterIdentityChange("market")
        } finally {
          set({ serverPending: false })
        }
        return true
      },
      setCurrency: (currency) => set({ currency, currencyChosen: true }),
      setShipTo: (shipTo) => set(get().currencyChosen ? { shipTo, shipToChosen: true } : { shipTo, shipToChosen: true, currency: countryCurrency(shipTo) }),
      detectShipTo: (shipTo) => {
        if (get().shipToChosen || get().shipTo === shipTo) return
        set(get().currencyChosen ? { shipTo, shipToCity: null } : { shipTo, shipToCity: null, currency: countryCurrency(shipTo) })
      },
      setShipToCity: (shipToCity) => set({ shipToCity: shipToCity?.trim() ? shipToCity.trim().slice(0, 60) : null }),
      setInterests: (interests, aesthetics) => set({ interests, aesthetics }),
      finishOnboarding: () => set({ onboarded: true }),
      setNotifications: (p) => set({ notifications: { ...get().notifications, ...p } }),
      requireAuth: (intent, then) => {
        if (get().user) return true
        set({ authPrompt: { intent, then } })
        return false
      },
      dismissAuthPrompt: () => set({ authPrompt: null }),
    }),
    {
      name: "nocturne-session",
      storage: createJSONStorage(() => localStorage),
      // Everything but the sign-in prompt (it holds a callback and only lives for this visit) and
      // the in-flight flag.
      partialize: ({ user, signedOutAt, currency, currencyChosen, shipTo, shipToChosen, shipToCity, interests, aesthetics, onboarded, notifications }) => ({ user, signedOutAt, currency, currencyChosen, shipTo, shipToChosen, shipToCity, interests, aesthetics, onboarded, notifications }),
      skipHydration: true,
      // v1: the currency follows the delivery country until the shopper picks one. Sessions saved
      // before then defaulted to USD whatever the country, so only that old default moves to the
      // country's currency (and only when the two differ). Any other currency was picked on purpose
      // and is kept: it counts as chosen unless it is simply the country's own currency, which
      // the old country picker also set by itself.
      version: 1,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Partial<SessionState>
        if (version < 1) {
          const shipTo = s.shipTo && s.shipTo in countries ? s.shipTo : "NG"
          const local = countryCurrency(shipTo)
          const saved = s.currency
          if (!saved || saved === "USD") return { ...s, currency: local, currencyChosen: false } as SessionState
          return { ...s, currency: saved, currencyChosen: saved !== local } as SessionState
        }
        return s as SessionState
      },
    },
  ),
)
