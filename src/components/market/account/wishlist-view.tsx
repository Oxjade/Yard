"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { HeartIcon as Heart } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { ProductCard } from "@/components/market/product-card"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { brandById, priceUsd, productById, products } from "@/lib/data"
import { productStock } from "@/lib/data/products"
import { spring, variants } from "@/lib/motion"
import { useCart } from "@/lib/stores/cart"
import { useSaved } from "@/lib/stores/saved"
import type { Product } from "@/lib/data/types"
import { YouNav } from "./you-nav"

type Sort = "recent" | "price-asc" | "price-desc" | "brand" | "in-stock"

const sortLabels: Record<Sort, string> = {
  recent: "Recently saved",
  "price-asc": "Price, low to high",
  "price-desc": "Price, high to low",
  brand: "Brand, A to Z",
  "in-stock": "In stock first",
}

/**
 * Wraps a card so that adding it to the bag through its QuickAdd moves it out of the
 * wishlist. The add is recognised by a click inside this card (popover included, since
 * React events bubble through portals) followed by a cart add for this product.
 */
function MoveToBag({ product, onMoved, children }: { product: Product; onMoved?: (productId: string) => void; children: React.ReactNode }) {
  const armed = useRef(false)

  useEffect(
    () =>
      useCart.subscribe((s, prev) => {
        if (!armed.current || s.pulse === prev.pulse || s.lastAdded?.productId !== product.id) return
        armed.current = false
        const saved = useSaved.getState()
        if (!saved.wishlist.includes(product.id)) return
        saved.toggleWishlist(product.id)
        onMoved?.(product.id)
        toast("Moved out of your wishlist", {
          description: product.name,
          action: {
            label: "Undo",
            onClick: () => {
              if (!useSaved.getState().wishlist.includes(product.id)) useSaved.getState().toggleWishlist(product.id)
            },
          },
        })
      }),
    [product.id, product.name, onMoved],
  )

  return (
    <div
      onClickCapture={() => {
        armed.current = true
        window.setTimeout(() => {
          armed.current = false
        }, 0)
      }}
    >
      {children}
    </div>
  )
}

export function WishlistView() {
  const wishlist = useSaved((s) => s.wishlist)
  const [sort, setSort] = useState<Sort>("recent")

  const saved = useMemo(() => wishlist.map((id) => productById.get(id)).filter((p): p is Product => !!p), [wishlist])
  const sorted = useMemo(() => {
    const list = [...saved]
    if (sort === "price-asc") list.sort((a, b) => priceUsd(a) - priceUsd(b))
    if (sort === "price-desc") list.sort((a, b) => priceUsd(b) - priceUsd(a))
    if (sort === "brand") list.sort((a, b) => brandById.get(a.brandId)!.name.localeCompare(brandById.get(b.brandId)!.name))
    if (sort === "in-stock") list.sort((a, b) => Number(productStock(b) > 0) - Number(productStock(a) > 0))
    return list
  }, [saved, sort])
  const brandCount = new Set(saved.map((p) => p.brandId)).size
  const soldOut = saved.filter((p) => productStock(p) === 0).length
  const mostSaved = useMemo(() => [...products].sort((a, b) => b.stats.wishlists - a.stats.wishlists).slice(0, 4), [])

  // Removing a piece unmounts its card. Focus moves to the heart of the card that takes its
  // place (or the one before, for the last card), or to the empty state, so keyboard users
  // keep their position instead of starting again from the top of the page.
  const cards = useRef(new Map<string, HTMLDivElement>())
  const emptyTitle = useRef<HTMLParagraphElement>(null)
  /** Set when a piece moves to the bag: its QuickAdd popover is closing, so focus waits for the card to leave. */
  const focusAfterExit = useRef<string | null | undefined>(undefined)

  const neighbourOf = useCallback(
    (id: string) => {
      const i = sorted.findIndex((p) => p.id === id)
      return sorted[i + 1]?.id ?? sorted[i - 1]?.id ?? null
    },
    [sorted],
  )
  const focusPiece = useCallback((id: string | null) => {
    const heart = id ? cards.current.get(id)?.querySelector<HTMLElement>('button[aria-label$="from wishlist"]') : null
    ;(heart ?? emptyTitle.current)?.focus()
  }, [])
  const focusLost = () => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected

  /** The heart was pressed on a saved piece: move focus at once, so a second press can't re-save the leaving card. */
  const onHeartRemove = useCallback(
    (id: string) => {
      const next = neighbourOf(id)
      window.requestAnimationFrame(() => focusPiece(next))
    },
    [neighbourOf, focusPiece],
  )
  const onMovedToBag = useCallback(
    (id: string) => {
      const next = neighbourOf(id)
      // The last piece: the grid is replaced by the empty state, with no exit to wait for.
      if (next) {
        focusAfterExit.current = next
        return
      }
      window.requestAnimationFrame(() => {
        if (focusLost()) focusPiece(null)
      })
    },
    [neighbourOf, focusPiece],
  )

  return (
    <>
      <header>
        <p className="text-sm text-violet">Your World</p>
        <h1 className="mt-2 font-display text-display-lg text-ink">Wishlist</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">
          {saved.length
            ? `${saved.length} saved ${saved.length === 1 ? "piece" : "pieces"} from ${brandCount} ${brandCount === 1 ? "brand" : "brands"}. Add one to your cart and it moves out of your wishlist.`
            : "Pieces you save from any brand wait here until you're ready."}
        </p>
      </header>
      <YouNav className="mt-8" />

      {saved.length === 0 ? (
        <>
          <div className="mt-12 flex flex-col items-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-16 text-center">
            <span className="inline-flex size-14 items-center justify-center rounded-full border border-line">
              <Heart className="size-6 text-ink-2" />
            </span>
            <div>
              <p ref={emptyTitle} tabIndex={-1} className="text-base text-ink outline-none">Nothing saved yet</p>
              <p className="mt-1 max-w-sm text-sm text-ink-2">Tap the heart on any piece to keep it here until you&apos;re ready.</p>
            </div>
            <Button asChild variant="primary">
              <Link href="/shop?sort=newest">Browse new arrivals</Link>
            </Button>
          </div>
          <section aria-labelledby="most-saved-title" className="mt-24 md:mt-32">
            <div id="most-saved-title">
              <SectionHeader title="Most saved right now" description="The pieces other shoppers are keeping an eye on." href="/shop?sort=trending" />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
              {mostSaved.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-2" aria-live="polite">
              {saved.length} {saved.length === 1 ? "piece" : "pieces"}
              {soldOut ? `, ${soldOut} sold out` : ""}
            </p>
            <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
              <SelectTrigger aria-label="Sort wishlist" className="h-11 min-w-44 rounded-md border-line bg-surface px-3 text-sm transition-colors hover:border-ink-3/60 data-[size=default]:h-11">
                <span className="text-ink-3">Sort</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {(Object.keys(sortLabels) as Sort[]).map((k) => (
                  <SelectItem key={k} value={k}>{sortLabels[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <motion.div layout className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3 lg:grid-cols-4">
            <AnimatePresence
              mode="popLayout"
              initial={false}
              onExitComplete={() => {
                const next = focusAfterExit.current
                focusAfterExit.current = undefined
                // Only when focus went down with the card; never take it from somewhere else.
                if (next !== undefined)
                  window.requestAnimationFrame(() => {
                    if (focusLost()) focusPiece(next)
                  })
              }}
            >
              {sorted.map((p) => (
                <motion.div
                  key={p.id}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) cards.current.set(p.id, el)
                    else cards.current.delete(p.id)
                  }}
                  layout
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.94, transition: variants.listItem.exit.transition }}
                  transition={spring.layout}
                  onClickCapture={(e) => {
                    // The heart toggles in its own click handler, after this capture runs.
                    const heart = (e.target as HTMLElement).closest('button[aria-label$="from wishlist"]')
                    if (heart?.getAttribute("aria-pressed") === "true") onHeartRemove(p.id)
                  }}
                >
                  <MoveToBag product={p} onMoved={onMovedToBag}>
                    <ProductCard product={p} />
                  </MoveToBag>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
          <p className="mt-10 text-xs text-ink-3">Prices show in your currency as an estimate. The brand&apos;s price is confirmed at checkout.</p>
        </>
      )}
    </>
  )
}
