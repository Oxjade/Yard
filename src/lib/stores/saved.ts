"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

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
      toggleWishlist: (id) => {
        const next = toggle(get().wishlist, id)
        set({ wishlist: next })
        return next.includes(id)
      },
      toggleFollow: (id) => {
        const next = toggle(get().following, id)
        set({ following: next })
        return next.includes(id)
      },
      toggleNotify: (id) => {
        const next = toggle(get().notify, id)
        set({ notify: next })
        return next.includes(id)
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
