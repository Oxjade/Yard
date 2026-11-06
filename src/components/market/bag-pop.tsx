"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { variantById, variantLabel } from "@/lib/data/products"
import { MAX_QTY_PER_LINE, useCart, type CartLine } from "@/lib/stores/cart"
import { useSession } from "@/lib/stores/session"
import { Price } from "./price"

/** One add, as the bubble tells it: which piece, how many actually went in, and how many of it the bag now holds. */
type Added = { key: number; variantId: string; quantity: number; total: number }

const quantityOf = (lines: CartLine[], variantId: string) => lines.find((l) => l.variantId === variantId)?.quantity ?? 0

/**
 * The 10-per-line cap, worded for the piece: a bag line is one size and colour, so a shopper can
 * still add other sizes or colours of the same piece.
 */
function capNote(options: Record<string, string>) {
  const kinds = [options.Size && options.Size !== "One size" ? "size" : null, options.Colour ? "colour" : null].filter(Boolean)
  return kinds.length ? `${MAX_QTY_PER_LINE} is the most per ${kinds.join(" and ")}` : `${MAX_QTY_PER_LINE} is the most for this piece`
}

/**
 * "Added to bag" pops out of the bag icon like a comic speech bubble — tail pointing at
 * the bag — and tucks itself away after a few seconds (it stays while hovered).
 *
 * It listens to the cart itself, so every add confirms here whichever control made it (the
 * product page, a card's quick add or its size picker): each add bumps `pulse`, and the line's
 * quantity before and after says how many went in (adding 2 reads "2 added to bag!" with the
 * price of both) and how many of that piece the bag now holds ("Size M, 3 in your bag"); an add
 * the 10-per-line cap absorbs says the bag already holds the most of that size and colour, with
 * the count. Opening the bag puts the bubble away.
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
        const total = quantityOf(s.lines, variantId)
        setAdded({ key: s.pulse, variantId, quantity: total - quantityOf(prev.lines, variantId), total })
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
  const count = added ? `${added.total} in your bag` : ""
  const note = hit && capped ? capNote(hit.variant.options) : ""

  return (
    <>
      {/* One live region that stays mounted, so every add is announced (a region that mounts
          with its text, like each new bubble, is often missed by screen readers). */}
      <p role="status" className="sr-only">
        {added && hit ? `${title.replace(/!$/, "")}: ${hit.product.name}, ${variant}, ${count}.${note ? ` ${note}.` : ""}` : ""}
      </p>
      <AnimatePresence>
        {added && hit ? (
          <motion.div
            key={`pop-${added.key}`}
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
                <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[13px] font-medium">
                  <span className="min-w-0 truncate">{hit.product.name}</span>
                  {capped ? null : (
                    <Price amount={hit.product.price * added.quantity} currency={hit.product.currency} className="shrink-0 text-[12px] font-medium text-obsidian [&_s]:text-[#777]" />
                  )}
                </p>
                {/* Only the variant ever truncates: how many the bag holds always shows. */}
                <p className="flex text-[12px] text-[#4a4a4a]">
                  <span className="min-w-0 truncate">{variant}</span>
                  <span className="shrink-0 whitespace-nowrap">, {count}</span>
                </p>
                {note ? <p className="text-[12px] text-[#4a4a4a]">{note}</p> : null}
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
    </>
  )
}
