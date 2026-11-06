"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { toast } from "sonner"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import type { DemoSignInResult, ShopperProfile } from "@/lib/api/contracts/session"
import type { Aesthetic, CategorySlug } from "@/lib/data/types"
import { afterIdentityChange } from "@/lib/session/identity"

/**
 * The marketplace session in this browser. Guests can browse everything; following, saving and
 * buying ask them to sign in first (blueprint §8.1). In v2 the identity itself lives on the
 * server (a demo shopper session, §2.3): signing in calls POST /api/auth/demo as the demo shopper
 * Ada Nwosu and the local user is set from the server's profile; signing out ends the server
 * session first and only then the local one. SessionSync keeps the two in step, and other tabs
 * follow through the persisted state.
 */

export type SessionUser = {
  id: string
  name: string
  email: string
  provider: "google" | "apple" | "email"
}

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
  shipTo: CountryCode
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
  setCurrency: (c: CurrencyCode) => void
  setShipTo: (c: CountryCode) => void
  setShipToCity: (city: string | null) => void
  setInterests: (interests: CategorySlug[], aesthetics: Aesthetic[]) => void
  finishOnboarding: () => void
  setNotifications: (p: Partial<NotificationPrefs>) => void
  requireAuth: (intent: AuthIntent, then?: () => void) => boolean
  dismissAuthPrompt: () => void
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      user: null,
      currency: "USD",
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
        try {
          await afterIdentityChange("market")
        } finally {
          set({ serverPending: false })
        }
        return true
      },
      setCurrency: (currency) => set({ currency }),
      setShipTo: (shipTo) => set({ shipTo }),
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
      partialize: ({ user, signedOutAt, currency, shipTo, shipToCity, interests, aesthetics, onboarded, notifications }) => ({ user, signedOutAt, currency, shipTo, shipToCity, interests, aesthetics, onboarded, notifications }),
      skipHydration: true,
    },
  ),
)
