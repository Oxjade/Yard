"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { toast } from "sonner"
import { api } from "@/lib/api/client"
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
      toggleWishlist: (id) => {
        const next = toggle(get().wishlist, id)
        set({ wishlist: next })
        const on = next.includes(id)
        void api(on ? "/api/wishlist" : `/api/wishlist/${encodeURIComponent(id)}`, on ? { body: { productId: id } } : { method: "DELETE" }).catch(() => {
          const current = get().wishlist
          if (current.includes(id) === on) set({ wishlist: toggle(current, id) })
          toast.error("Your wishlist change couldn’t be saved. Try again.")
        })
        return on
      },
      toggleFollow: (id) => {
        const next = toggle(get().following, id)
        set({ following: next })
        const on = next.includes(id)
        void api(on ? "/api/follows" : `/api/follows/${encodeURIComponent(id)}`, on ? { body: { brandId: id } } : { method: "DELETE" }).catch(() => {
          const current = get().following
          if (current.includes(id) === on) set({ following: toggle(current, id) })
          toast.error("Your follow change couldn’t be saved. Try again.")
        })
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

/** Merge browser saves after sign-in, then replace local lists with the account's authoritative state. */
export async function syncSavedWithServer() {
  const { wishlist, following } = useSaved.getState()
  await api("/api/wishlist/merge", { body: { productIds: wishlist, brandIds: following } })
  const [saved, follows] = await Promise.all([
    api<{ items: { productId: string }[] }>("/api/wishlist"),
    api<{ items: { brandId: string }[] }>("/api/follows"),
  ])
  useSaved.setState({ wishlist: saved.items.map((item) => item.productId), following: follows.items.map((item) => item.brandId) })
}
