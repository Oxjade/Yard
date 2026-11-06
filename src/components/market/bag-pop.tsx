"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { variantById, variantLabel } from "@/lib/data/products"
import { MAX_QTY_PER_LINE, useCart, type CartLine } from "@/lib/stores/cart"
import { useSession } from "@/lib/stores/session"
import { Price } from "./price"

/** One add, as the bubble tells it: which piece, and how many actually went in. */
type Added = { key: number; variantId: string; quantity: number }

const quantityOf = (lines: CartLine[], variantId: string) => lines.find((l) => l.variantId === variantId)?.quantity ?? 0

/**
 * "Added to bag" pops out of the bag icon like a comic speech bubble — tail pointing at
 * the bag — and tucks itself away after a few seconds (it stays while hovered).
 *
 * It listens to the cart itself: each add bumps `pulse`, and the line's quantity before and
 * after says how many went in (adding 2 reads "2 added to bag!" with the price of both, and an
 * add the 10-per-line cap absorbs says the bag already holds the most). Opening the bag puts the
 * bubble away.
 */
export function BagPop() {
  const router = useRouter()
  const openBag = useCart((s) => s.open)
  const requireAuth = useSession((s) => s.requireAuth)
  const [added, setAdded] = useState<Added | null>(null)
  const [hover, setHover] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () =>
      useCart.subscribe((s, prev) => {
        // The open bag shows the add itself; opening it puts the bubble away.
        if (s.isOpen) {
          if (!prev.isOpen) setAdded(null)
          return
        }
        if (s.pulse === prev.pulse || !s.lastAdded) return
        const { variantId } = s.lastAdded
        setAdded({ key: s.pulse, variantId, quantity: quantityOf(s.lines, variantId) - quantityOf(prev.lines, variantId) })
      }),
    [],
  )

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (added && !hover) timer.current = window.setTimeout(() => setAdded(null), 3600)
    return () => window.clearTimeout(timer.current)
  }, [added, hover])

  const hit = added ? variantById.get(added.variantId) : undefined
  const capped = added !== null && added.quantity <= 0
  const title = capped ? "Already in your bag" : added && added.quantity > 1 ? `${added.quantity} added to bag!` : "Added to bag!"
  const variant = hit ? variantLabel(hit.variant.options) || "One size" : ""

  return (
    <AnimatePresence>
      {added && hit ? (
        <motion.div
          key={`pop-${added.key}`}
          role="status"
          aria-live="polite"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          className="pop-bubble pop-tail pop-tail-up absolute top-full right-[-6px] z-50 mt-4 w-[min(310px,calc(100vw-1.5rem))] p-3"
          style={{ transformOrigin: "calc(100% - 26px) -10px", ["--tail-x" as string]: "18px" }}
          initial={{ opacity: 0, scale: 0.4, rotate: 6, y: -6 }}
          animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
          exit={{ opacity: 0, scale: 0.7, y: -4, transition: { duration: 0.16 } }}
          transition={{ type: "spring", stiffness: 560, damping: 20, mass: 0.7 }}
        >
          <div className="flex gap-3">
            <span className="relative h-16 w-13 shrink-0 overflow-hidden rounded-md border-2 border-obsidian bg-[#e9e9e9]">
              <Image src={hit.product.images[0].src} alt="" fill sizes="52px" className="object-cover" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[1.35rem] leading-none">{title}</p>
              <p className="mt-1.5 truncate text-[13px] font-medium">{hit.product.name}</p>
              <p className="flex items-center justify-between gap-2 text-[12px] text-[#4a4a4a]">
                <span className="truncate">{capped ? `${variant}, up to ${MAX_QTY_PER_LINE} per order` : added.quantity > 1 ? `${variant}, ${added.quantity} pieces` : variant}</span>
                {capped ? null : (
                  <Price amount={hit.product.price * added.quantity} currency={hit.product.currency} className="text-[12px] font-medium text-obsidian [&_s]:text-[#777]" />
                )}
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setAdded(null)
                openBag()
              }}
              className="h-9 rounded-md border-2 border-obsidian text-[12.5px] font-semibold transition-[background-color,transform] duration-150 hover:bg-obsidian hover:text-ink active:scale-[0.97]"
            >
              View bag
            </button>
            <button
              type="button"
              onClick={() => {
                setAdded(null)
                const go = () => router.push("/checkout")
                if (requireAuth("checkout", go)) go()
              }}
              className="h-9 rounded-md border-2 border-obsidian bg-acid text-[12.5px] font-semibold text-obsidian transition-[background-color,transform] duration-150 hover:bg-acid/80 active:scale-[0.97]"
            >
              Checkout
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
