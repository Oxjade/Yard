"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import type { Aesthetic, CategorySlug } from "@/lib/data/types"

/**
 * Frontend session. Guests can browse everything; following, saving and buying ask
 * them to sign in first (blueprint §8.1). Replaced by Better Auth in the backend phase.
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

export type AuthIntent = "follow" | "save" | "notify" | "checkout" | "account"

type SessionState = {
  user: SessionUser | null
  currency: CurrencyCode
  shipTo: CountryCode
  interests: CategorySlug[]
  aesthetics: Aesthetic[]
  onboarded: boolean
  notifications: NotificationPrefs
  /** The action a guest attempted, which opens the sign-in prompt. */
  authPrompt: { intent: AuthIntent; then?: () => void } | null
  signIn: (user: SessionUser) => void
  /** Change the signed-in shopper's name and email. */
  updateProfile: (details: { name: string; email: string }) => void
  signOut: () => void
  setCurrency: (c: CurrencyCode) => void
  setShipTo: (c: CountryCode) => void
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
      signIn: (user) => {
        const pending = get().authPrompt?.then
        set({ user, authPrompt: null })
        pending?.()
      },
      updateProfile: ({ name, email }) => {
        const user = get().user
        if (user) set({ user: { ...user, name, email } })
      },
      signOut: () => set({ user: null }),
      setCurrency: (currency) => set({ currency }),
      setShipTo: (shipTo) => set({ shipTo }),
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
      partialize: ({ authPrompt: _authPrompt, ...rest }) => rest,
      skipHydration: true,
    },
  ),
)
