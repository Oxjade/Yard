"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { toast } from "sonner"
import { ApiError, api } from "@/lib/api/client"
import { variantById } from "@/lib/data/products"

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
  add: (productId: string, variantId: string, quantity?: number, opts?: { open?: boolean }) => Promise<void>
  setQuantity: (variantId: string, quantity: number) => Promise<void>
  remove: (variantId: string) => Promise<void>
  clear: () => void
  syncFromServer: () => Promise<void>
  open: () => void
  close: () => void
  setOpen: (open: boolean) => void
}

export const MAX_QTY_PER_LINE = 10
const cartMigrationKey = "yard:cart:server-v1"

type ServerCart = { lines: { variantId: string; productId: string | null; qty: number }[] }

let syncing = false

function showCartError(error: unknown) {
  toast.error(error instanceof ApiError ? error.message : "Your cart couldn't be updated. Try again.")
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],
      isOpen: false,
      pulse: 0,
      lastAdded: null,
      add: async (productId, variantId, quantity = 1, opts) => {
        await api("/api/cart/lines", { body: { variantId, qty: quantity } })
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
      setQuantity: async (variantId, quantity) => {
        const nextQuantity = Math.max(0, Math.min(MAX_QTY_PER_LINE, quantity))
        try {
          await api(`/api/cart/lines/${encodeURIComponent(variantId)}`, { method: "PATCH", body: { qty: nextQuantity } })
        } catch (error) {
          showCartError(error)
          return
        }
        set({
          lines:
            nextQuantity === 0
              ? get().lines.filter((l) => l.variantId !== variantId)
              : get().lines.map((l) => (l.variantId === variantId ? { ...l, quantity: nextQuantity } : l)),
        })
      },
      remove: async (variantId) => {
        try {
          await api(`/api/cart/lines/${encodeURIComponent(variantId)}`, { method: "DELETE" })
          set({ lines: get().lines.filter((l) => l.variantId !== variantId) })
        } catch (error) {
          showCartError(error)
        }
      },
      clear: () => {
        set({ lines: [] })
        void api("/api/cart", { method: "DELETE" }).catch(showCartError)
      },
      syncFromServer: async () => {
        if (typeof window === "undefined" || syncing) return
        syncing = true
        const stored = get().lines
        try {
          let remote = await api<ServerCart>("/api/cart", { query: { currency: "USD" } })
          const migrationState = localStorage.getItem(cartMigrationKey)
          const pendingAt = migrationState?.startsWith("pending:") ? Number(migrationState.slice(8)) : 0
          if (pendingAt && Date.now() - pendingAt < 30_000) return
          if (migrationState !== "done") {
            localStorage.setItem(cartMigrationKey, `pending:${Date.now()}`)
            try {
              const serverQty = new Map(remote.lines.map((line) => [line.variantId, line.qty]))
              for (const line of stored) {
                const delta = line.quantity - (serverQty.get(line.variantId) ?? 0)
                if (delta <= 0) continue
                try {
                  await api("/api/cart/lines", { body: { variantId: line.variantId, qty: delta } })
                } catch (error) {
                  if (!(error instanceof ApiError) || ![404, 409, 422].includes(error.status)) throw error
                }
              }
              localStorage.setItem(cartMigrationKey, "done")
              remote = await api<ServerCart>("/api/cart", { query: { currency: "USD" } })
            } catch (error) {
              localStorage.removeItem(cartMigrationKey)
              throw error
            }
          }
          const previous = new Map(stored.map((line) => [line.variantId, line]))
          const lines = remote.lines.flatMap((line) => {
            const hit = variantById.get(line.variantId)
            if (!hit || (line.productId && hit.product.id !== line.productId)) return []
            return [{ productId: hit.product.id, variantId: line.variantId, quantity: line.qty, addedAt: previous.get(line.variantId)?.addedAt ?? Date.now() }]
          })
          set({ lines })
        } catch {
          // Keep the persisted cart visible when the server is temporarily unreachable.
        } finally {
          syncing = false
        }
      },
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
