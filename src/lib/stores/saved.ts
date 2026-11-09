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
  /** The shopper whose account the wishlist and follows mirror; null while they're this browser's own. */
  owner: string | null
  /** The browser's own saves were taken over by `owner` but not merged into the account yet (a merge failed). */
  unmerged: boolean
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
      owner: null,
      unmerged: false,
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

/** The merge endpoint's per-list cap (mergeSavedBody). */
const MERGE_CHUNK = 200

/**
 * After sign-in: merge this browser's own saves into the account, then replace the local lists with
 * the account's authoritative state. Lists that already mirror another account (an account switch,
 * or a sign-out this tab missed) are never merged into this one; they are just replaced.
 *
 * The lists belong to the account from the moment the sync starts, so a failed merge can't leave
 * them unowned (and merged into whoever signs in next); `unmerged` retries the merge on the next
 * load. Once merged, a page load only reads: the merge endpoint is rate limited.
 */
export async function syncSavedWithServer(shopperId: string) {
  if (!useSaved.persist.hasHydrated()) await useSaved.persist.rehydrate()
  const { wishlist, following, owner, unmerged } = useSaved.getState()
  if (!owner) useSaved.setState({ owner: shopperId, unmerged: wishlist.length > 0 || following.length > 0 })
  if (!owner ? wishlist.length > 0 || following.length > 0 : owner === shopperId && unmerged) {
    for (let i = 0; i < Math.max(wishlist.length, following.length); i += MERGE_CHUNK) {
      await api("/api/wishlist/merge", { body: { productIds: wishlist.slice(i, i + MERGE_CHUNK), brandIds: following.slice(i, i + MERGE_CHUNK) } })
    }
    useSaved.setState({ unmerged: false })
  }
  const [saved, follows] = await Promise.all([
    api<{ items: { productId: string }[] }>("/api/wishlist"),
    api<{ items: { brandId: string }[] }>("/api/follows"),
  ])
  useSaved.setState({ wishlist: saved.items.map((item) => item.productId), following: follows.items.map((item) => item.brandId), owner: shopperId, unmerged: false })
}

/** Signed out: the account's wishlist and follows leave with it (they stay on the server for the next sign-in). */
export function clearAccountSaves() {
  if (useSaved.getState().owner) useSaved.setState({ wishlist: [], following: [], owner: null, unmerged: false })
}
