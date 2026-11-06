"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ProductCard } from "@/components/market/product-card"
import type { AddBlocked } from "@/components/market/quick-add"
import { useHydrated } from "@/hooks/use-hydrated"
import { drops } from "@/lib/data"
import { useCart } from "@/lib/stores/cart"
import type { Drop, Product } from "@/lib/data/types"
import { releasesIn, useDropClock, type DropClock } from "./use-drop-phase"

const dropById = new Map(drops.map((d) => [d.id, d]))

/** The drop a product is released in, if it belongs to one. */
export function dropOf(product: Product) {
  return product.dropId ? dropById.get(product.dropId) : undefined
}

export type DropAddBlock = DropClock & {
  /** Pieces from this drop already in the bag. */
  inBag: number
  atLimit: boolean
  /** Adding is closed: before release, sold out, or the per-customer limit is reached. */
  blocked: boolean
  /** Pass to ProductCard's addBlocked; undefined while adding is open. */
  addBlocked: AddBlocked | undefined
}

/**
 * When a drop's pieces can go in the bag, and what a tap says when they can't. The drop page
 * and every product card outside it (storefront sections, collections, stories) use this, so a
 * piece is never addable in one place and locked in another: previews before release, open
 * while live up to the per-customer limit across the whole drop, closed once sold out. Ended
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
  const atLimit = phase === "live" && inBag >= drop.limitPerCustomer
  const blocked = phase === "upcoming" || phase === "sold-out" || atLimit

  const seeDrop = onDropPage ? undefined : { label: "See the drop", onClick: () => router.push(`/drops/${drop.slug}`) }

  // A tap on a closed quick add explains why instead of adding.
  function onAttempt() {
    if (phase === "upcoming") {
      const opens = now !== null && release !== null ? `${drop.name} opens in ${releasesIn(release - now)}.` : `${drop.name} hasn't opened yet.`
      const next = drop.access === "draw" ? "Enter the draw before then." : "Set a reminder to get an alert when it opens."
      toast("Not released yet", { description: `${opens} ${next}`, action: seeDrop })
    } else if (phase === "sold-out") {
      toast("Sold out", { description: `Every piece in ${drop.name} has gone.`, action: seeDrop })
    } else {
      toast("Drop limit reached", {
        description: `${drop.name} allows ${drop.limitPerCustomer} per customer, and your bag already has ${inBag}.`,
        action: { label: "View bag", onClick: () => useCart.getState().open() },
      })
    }
  }

  return { ...clock, inBag, atLimit, blocked, addBlocked: blocked ? { describedBy, onAttempt } : undefined }
}

type CardProps = React.ComponentProps<typeof ProductCard>

function DropPieceCard({ drop, ...props }: CardProps & { drop: Drop }) {
  const { addBlocked } = useDropAddBlock(drop)
  return <ProductCard {...props} addBlocked={addBlocked} />
}

/**
 * ProductCard for listings outside the drop page: a piece released in a drop keeps the drop's
 * rules (see useDropAddBlock); every other piece is the plain card.
 */
export function ShopProductCard(props: CardProps) {
  const drop = dropOf(props.product)
  return drop ? <DropPieceCard {...props} drop={drop} /> : <ProductCard {...props} />
}
