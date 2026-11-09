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

/** A line this browser held that the server cart refused (sold out, or no longer sold): shown, never checked out. */
export type UnavailableCartLine = CartLine & { reason: string }

type CartState = {
  lines: CartLine[]
  /** Lines the server refused when this browser's bag moved onto the server cart. Kept visible until removed. */
  unavailable: UnavailableCartLine[]
  isOpen: boolean
  /** Bumped on every add so the bag icon can animate. */
  pulse: number
  lastAdded: { productId: string; variantId: string } | null
  add: (productId: string, variantId: string, quantity?: number, opts?: { open?: boolean }) => Promise<void>
  setQuantity: (variantId: string, quantity: number) => Promise<void>
  remove: (variantId: string) => Promise<void>
  /** Forgets one unavailable line (or all of them). Local only: the server never held them. */
  dismissUnavailable: (variantId?: string) => void
  clear: () => void
  /**
   * Reloads the bag from the server cart. `reset` first drops this browser's lines (an identity
   * change: the previous shopper's lines must not stay on screen) and never pushes them to the
   * server. A newer call always wins over an older one still in flight.
   */
  syncFromServer: (opts?: { reset?: boolean }) => Promise<void>
  open: () => void
  close: () => void
  setOpen: (open: boolean) => void
}

/** The most of one piece a cart line holds: the server's own limit (src/server/cart MAX_QTY is 20; the bag stays below it). */
export const MAX_QTY_PER_LINE = 10
const cartMigrationKey = "yard:cart:server-v1"

type ServerCart = { lines: { variantId: string; productId: string | null; qty: number }[] }

let generation = 0
let migration: Promise<boolean> | null = null

function showCartError(error: unknown) {
  toast.error(error instanceof ApiError ? error.message : "Your cart couldn't be updated. Try again.")
}

const sameLines = (a: CartLine[], b: CartLine[]) => a.length === b.length && a.every((l, i) => l.variantId === b[i].variantId && l.quantity === b[i].quantity && l.productId === b[i].productId)

export const useCart = create<CartState>()(
  persist(
    (set, get) => {
      /**
       * Moves a v2 bag (kept only in this browser) onto the server cart, once per browser. Lines the
       * server refuses stay visible as unavailable instead of disappearing. Resolves true when another
       * tab is migrating right now (this tab then keeps what it shows).
       */
      async function migrateLocal(stored: CartLine[]): Promise<boolean> {
        const state = localStorage.getItem(cartMigrationKey)
        if (state === "done") return false
        const pendingAt = state?.startsWith("pending:") ? Number(state.slice(8)) : 0
        if (pendingAt && Date.now() - pendingAt < 30_000) return true
        localStorage.setItem(cartMigrationKey, `pending:${Date.now()}`)
        try {
          const remote = await api<ServerCart>("/api/cart", { query: { currency: "USD" } })
          const serverQty = new Map(remote.lines.map((line) => [line.variantId, line.qty]))
          const refused: UnavailableCartLine[] = []
          for (const line of stored) {
            const delta = Math.min(MAX_QTY_PER_LINE, line.quantity) - (serverQty.get(line.variantId) ?? 0)
            if (delta <= 0) continue
            try {
              await api("/api/cart/lines", { body: { variantId: line.variantId, qty: delta } })
            } catch (error) {
              if (!(error instanceof ApiError) || ![404, 409, 422].includes(error.status)) throw error
              refused.push({ ...line, reason: error.status === 404 ? "No longer available" : error.message || "Not available in this quantity" })
            }
          }
          localStorage.setItem(cartMigrationKey, "done")
          if (refused.length) {
            const known = new Set(refused.map((l) => l.variantId))
            set({ unavailable: [...get().unavailable.filter((l) => !known.has(l.variantId)), ...refused] })
            toast(refused.length === 1 ? "A piece in your cart is no longer available. It's marked in your cart." : `${refused.length} pieces in your cart are no longer available. They're marked in your cart.`)
          }
          return false
        } catch (error) {
          localStorage.removeItem(cartMigrationKey)
          throw error
        }
      }

      return {
        lines: [],
        unavailable: [],
        isOpen: false,
        pulse: 0,
        lastAdded: null,
        add: async (productId, variantId, quantity = 1, opts) => {
          const existing = get().lines.find((l) => l.variantId === variantId)
          // One cap on both sides: never ask the server for more than the bag can show.
          const qty = Math.max(0, Math.min(quantity, MAX_QTY_PER_LINE - (existing?.quantity ?? 0)))
          if (!existing && qty <= 0) return
          if (qty > 0) await api("/api/cart/lines", { body: { variantId, qty } })
          const lines = existing
            ? get().lines.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(MAX_QTY_PER_LINE, l.quantity + qty) } : l))
            : [...get().lines, { productId, variantId, quantity: qty, addedAt: Date.now() }]
          set({
            lines,
            unavailable: get().unavailable.filter((l) => l.variantId !== variantId),
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
            // The line may have gone from the server cart (another device, a merge): show what it holds.
            if (error instanceof ApiError && error.status === 404) void get().syncFromServer()
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
            if (error instanceof ApiError && error.status === 404) void get().syncFromServer()
          }
        },
        dismissUnavailable: (variantId) => set({ unavailable: variantId ? get().unavailable.filter((l) => l.variantId !== variantId) : [] }),
        clear: () => {
          set({ lines: [] })
          void api("/api/cart", { method: "DELETE" }).catch(showCartError)
        },
        syncFromServer: async (opts) => {
          if (typeof window === "undefined") return
          const mine = ++generation
          // An identity change: the previous shopper's lines go at once (their server cart stays theirs).
          if (opts?.reset) set({ lines: [], unavailable: [] })
          try {
            if (!opts?.reset) {
              migration ??= migrateLocal(get().lines).finally(() => {
                migration = null
              })
              if (await migration) return
            }
            const remote = await api<ServerCart>("/api/cart", { query: { currency: "USD" } })
            if (mine !== generation) return
            const previous = new Map(get().lines.map((line) => [line.variantId, line]))
            const over: string[] = []
            const lines = remote.lines.flatMap((line) => {
              const hit = variantById.get(line.variantId)
              if (!hit || (line.productId && hit.product.id !== line.productId)) return []
              if (line.qty > MAX_QTY_PER_LINE) over.push(line.variantId)
              return [{ productId: hit.product.id, variantId: line.variantId, quantity: Math.min(MAX_QTY_PER_LINE, line.qty), addedAt: previous.get(line.variantId)?.addedAt ?? Date.now() }]
            })
            // A merge of two carts can pass the bag's cap: bring the server line down to what the bag shows.
            await Promise.all(over.map((variantId) => api(`/api/cart/lines/${encodeURIComponent(variantId)}`, { method: "PATCH", body: { qty: MAX_QTY_PER_LINE } }).catch(() => undefined)))
            if (mine !== generation) return
            const onServer = new Set(lines.map((l) => l.variantId))
            const unavailable = get().unavailable.filter((l) => !onServer.has(l.variantId))
            if (!sameLines(get().lines, lines)) set({ lines })
            if (unavailable.length !== get().unavailable.length) set({ unavailable })
          } catch {
            // Keep the persisted cart visible when the server is temporarily unreachable.
          }
        },
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
        setOpen: (isOpen) => set({ isOpen }),
      }
    },
    {
      name: "nocturne-cart",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lines: s.lines, unavailable: s.unavailable }),
      skipHydration: true,
    },
  ),
)
