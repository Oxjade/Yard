"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { releasesIn, useDropClock, type DropClock } from "@/components/market/editorial/use-drop-phase"
import { useHydrated } from "@/hooks/use-hydrated"
import { drops } from "@/lib/data/catalog"
import { useCart } from "@/lib/stores/cart"
import type { Drop, Product } from "@/lib/data/types"

/** When adding is closed (a drop before release, a released draw, a per-customer limit): why, and what a tap does instead. */
export type AddBlocked = {
  /** An element that explains the block on the page (the drop page's status note). */
  describedBy?: string
  /** A short reason for assistive tech when nothing on the page explains it: "not released yet". */
  reason?: string
  onAttempt: () => void
}

const dropById = new Map(drops.map((d) => [d.id, d]))

/** The drop a product is released in, if it belongs to one. */
export function dropOf(product: Pick<Product, "dropId" | "brandSummary">) {
  if (product.brandSummary) return undefined
  return product.dropId ? dropById.get(product.dropId) : undefined
}

export type DropAddBlock = DropClock & {
  /** Pieces from this drop already in the bag. */
  inBag: number
  atLimit: boolean
  /**
   * A draw past its release, live or ended: entries closed, and only drawn winners can buy. It
   * stays closed after the window ends: no winners have been drawn in this build (the drops
   * backend isn't connected), so its pieces never fall back to general sale.
   */
  drawClosed: boolean
  /** Adding is closed: before release, a released draw, sold out, or the per-customer limit is reached. */
  blocked: boolean
  /** Pass to ProductCard's addBlocked; undefined while adding is open. */
  addBlocked: AddBlocked | undefined
}

/**
 * When a drop's pieces can go in the bag, and what a tap says when they can't. Every quick add
 * for a piece with a dropId applies this (QuickAdd derives it), and the drop page applies it
 * once for its whole grid, so a piece is never addable in one place and locked in another:
 * previews before release, open while live up to the per-customer limit across the whole drop,
 * closed once sold out. A draw never opens to everyone: once it releases, entries are closed and
 * only drawn winners can buy, and picking winners needs the drops backend (not connected in this
 * build), so its pieces stay closed through the live window and after it ends. Other ended
 * drops put leftover pieces back in the brand's shop.
 *
 * `onDropPage` drops the "See the drop" toast action when the shopper is already on it.
 */
export function useDropAddBlock(drop: Drop, { describedBy, intervalMs = 15_000, onDropPage = false }: { describedBy?: string; intervalMs?: number; onDropPage?: boolean } = {}): DropAddBlock {
  const clock = useDropClock(drop, intervalMs)
  const { phase, now, release } = clock
  const router = useRouter()
  const hydrated = useHydrated()
  const lines = useCart((s) => s.lines)
  const inBag = hydrated ? lines.filter((l) => drop.productIds.includes(l.productId)).reduce((n, l) => n + l.quantity, 0) : 0
  const drawClosed = drop.access === "draw" && (phase === "live" || phase === "ended")
  const atLimit = phase === "live" && !drawClosed && inBag >= drop.limitPerCustomer
  const blocked = phase === "upcoming" || phase === "sold-out" || drawClosed || atLimit

  const seeDrop = onDropPage ? undefined : { label: "See the drop", onClick: () => router.push(`/drops/${drop.slug}`) }

  // A tap on a closed quick add explains why instead of adding.
  function onAttempt() {
    if (phase === "upcoming") {
      const opens = now !== null && release !== null ? `${drop.name} opens in ${releasesIn(release - now)}.` : `${drop.name} hasn't opened yet.`
      const next = drop.access === "draw" ? "Enter the draw before then." : "Set a reminder to get an alert when it opens."
      toast("Not released yet", { description: `${opens} ${next}`, action: seeDrop })
    } else if (drawClosed) {
      toast(phase === "ended" ? "Draw ended" : "Entries closed", {
        description: "Only drawn winners can buy, and picking winners needs the drops backend, which isn't connected in this build.",
        action: seeDrop,
      })
    } else if (phase === "sold-out") {
      toast("Sold out", { description: `Every piece in ${drop.name} has gone.`, action: seeDrop })
    } else {
      toast("Drop limit reached", {
        description: `${drop.name} allows ${drop.limitPerCustomer} per customer, and your cart already has ${inBag}.`,
        action: { label: "View cart", onClick: () => useCart.getState().open() },
      })
    }
  }

  const reason = phase === "upcoming" ? "not released yet" : phase === "sold-out" ? "sold out" : drawClosed ? (phase === "ended" ? "draw ended" : "entries closed") : "drop limit reached"
  return { ...clock, inBag, atLimit, drawClosed, blocked, addBlocked: blocked ? { describedBy, reason, onAttempt } : undefined }
}
