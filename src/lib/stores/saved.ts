"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { reportSignal } from "@/components/signals/report-signal"

type SavedState = {
  wishlist: string[]
  following: string[]
  notify: string[]
  recentlyViewed: string[]
  toggleWishlist: (productId: string) => boolean
  toggleFollow: (brandId: string) => boolean
  toggleNotify: (dropId: string) => boolean
  viewed: (productId: string) => void
}

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list]
}

export const useSaved = create<SavedState>()(
  persist(
    (set, get) => ({
      wishlist: [],
      following: [],
      notify: [],
      recentlyViewed: [],
      // Each toggle also tells the server (§1.11, §6.3): fire and forget, only with a shopper session.
      // The server keeps its own state and counts real changes only.
      toggleWishlist: (id) => {
        const next = toggle(get().wishlist, id)
        set({ wishlist: next })
        const on = next.includes(id)
        reportSignal({ kind: on ? "wishlist_add" : "wishlist_remove", productId: id })
        return on
      },
      toggleFollow: (id) => {
        const next = toggle(get().following, id)
        set({ following: next })
        const on = next.includes(id)
        reportSignal({ kind: on ? "follow" : "unfollow", brandId: id })
        return on
      },
      toggleNotify: (id) => {
        const next = toggle(get().notify, id)
        set({ notify: next })
        const on = next.includes(id)
        reportSignal({ kind: on ? "reminder_set" : "reminder_unset", dropId: id })
        return on
      },
      viewed: (id) =>
        set({ recentlyViewed: [id, ...get().recentlyViewed.filter((x) => x !== id)].slice(0, 16) }),
    }),
    {
      name: "nocturne-saved",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
    },
  ),
)
