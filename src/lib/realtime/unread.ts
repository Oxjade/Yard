"use client"

import { create } from "zustand"
import type { Surface } from "@/lib/api/contracts/realtime"

/**
 * In-memory unread counts, one store per surface (§4.3), so a tab with both the marketplace and
 * Studio open never mixes the two. `null` means unknown: badges render nothing for it. Reset on
 * every identity change. F1 writes the stores; F2's provider fills them from the stream.
 */
type Unread = { conversations: number | null; set: (n: number | null) => void; reset: () => void }

const make = () =>
  create<Unread>((set) => ({
    conversations: null,
    set: (conversations) => set({ conversations }),
    reset: () => set({ conversations: null }),
  }))

export const unreadStores: Record<Surface, ReturnType<typeof make>> = { market: make(), studio: make(), admin: make() }

export function useUnread(surface: Surface) {
  return unreadStores[surface]((s) => s.conversations)
}

export function setUnread(surface: Surface, conversations: number | null) {
  unreadStores[surface].getState().set(conversations)
}

export function resetUnread(surface: Surface) {
  unreadStores[surface].getState().reset()
}
