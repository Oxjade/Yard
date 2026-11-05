"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export type CartLine = {
  productId: string
  variantId: string
  quantity: number
  addedAt: number
}

type CartState = {
  lines: CartLine[]
  isOpen: boolean
  /** Bumped on every add so the bag icon can animate. */
  pulse: number
  lastAdded: { productId: string; variantId: string } | null
  add: (productId: string, variantId: string, quantity?: number, opts?: { open?: boolean }) => void
  setQuantity: (variantId: string, quantity: number) => void
  remove: (variantId: string) => void
  clear: () => void
  open: () => void
  close: () => void
  setOpen: (open: boolean) => void
}

export const MAX_QTY_PER_LINE = 10

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      isOpen: false,
      pulse: 0,
      lastAdded: null,
      add: (productId, variantId, quantity = 1, opts) => {
        const existing = get().lines.find((l) => l.variantId === variantId)
        const lines = existing
          ? get().lines.map((l) =>
              l.variantId === variantId
                ? { ...l, quantity: Math.min(MAX_QTY_PER_LINE, l.quantity + quantity) }
                : l,
            )
          : [...get().lines, { productId, variantId, quantity, addedAt: Date.now() }]
        set({
          lines,
          pulse: get().pulse + 1,
          lastAdded: { productId, variantId },
          isOpen: opts?.open ?? get().isOpen,
        })
      },
      setQuantity: (variantId, quantity) =>
        set({
          lines:
            quantity <= 0
              ? get().lines.filter((l) => l.variantId !== variantId)
              : get().lines.map((l) =>
                  l.variantId === variantId ? { ...l, quantity: Math.min(MAX_QTY_PER_LINE, quantity) } : l,
                ),
        }),
      remove: (variantId) => set({ lines: get().lines.filter((l) => l.variantId !== variantId) }),
      clear: () => set({ lines: [] }),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      setOpen: (isOpen) => set({ isOpen }),
    }),
    {
      name: "nocturne-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lines: s.lines }),
      skipHydration: true,
    },
  ),
)
