"use client"

import { useEffect, useId, useRef } from "react"
import { toast } from "sonner"
import { ProductCard } from "@/components/market/product-card"
import { SectionHeader } from "@/components/market/section-header"
import { useHydrated } from "@/hooks/use-hydrated"
import { useCart } from "@/lib/stores/cart"
import { cn } from "@/lib/utils"
import type { Drop, Product } from "@/lib/data/types"
import { releasesIn, useDropClock } from "./use-drop-phase"

/**
 * The quick-add trigger inside ProductCard (it carries a stable "Quick add …" label).
 * Interim: ProductCard has no prop to block adding yet, so the grid catches the click and marks
 * the buttons aria-disabled itself. To be replaced by a shared `addBlocked` prop on ProductCard.
 */
const QUICK_ADD = 'button[aria-label^="Quick add"]'

/**
 * The pieces in a drop, as ProductCards. Before release they are previews: quick add is shown
 * disabled and a tap explains when it opens. While live, adding works up to the per-customer
 * limit across the whole drop. Once sold out, adding stays closed; once ended, leftover pieces
 * are ordinary catalogue items again.
 */
export function DropProducts({ drop, products, brandName }: { drop: Drop; products: Product[]; brandName: string }) {
  const { phase, now, release } = useDropClock(drop, 1000)
  const hydrated = useHydrated()
  const lines = useCart((s) => s.lines)
  const inBag = hydrated ? lines.filter((l) => drop.productIds.includes(l.productId)).reduce((n, l) => n + l.quantity, 0) : 0
  const atLimit = phase === "live" && inBag >= drop.limitPerCustomer
  const locked = phase === "upcoming" || phase === "sold-out"
  const blocked = locked || atLimit
  const gridRef = useRef<HTMLDivElement>(null)
  const noteId = useId()

  // Announce a locked quick add as unavailable, with the reason, while keeping it focusable so a
  // tap or Enter still explains why (the toast below).
  useEffect(() => {
    const buttons = gridRef.current?.querySelectorAll<HTMLButtonElement>(QUICK_ADD) ?? []
    for (const b of buttons) {
      if (blocked) {
        b.setAttribute("aria-disabled", "true")
        b.setAttribute("aria-describedby", noteId)
      } else {
        b.removeAttribute("aria-disabled")
        b.removeAttribute("aria-describedby")
      }
    }
  }, [blocked, noteId, hydrated])

  // The time left changes every minute, so it stays outside the live region; only the status
  // sentence (preview, live, at the limit, sold out) is announced when it changes.
  const until = phase === "upcoming" && now !== null && release !== null ? `Releases in ${releasesIn(release - now)}.` : null
  const note =
    phase === "upcoming"
      ? "These are previews; adding to your bag opens at release."
      : phase === "live"
        ? atLimit
          ? `Live now. Your bag has ${inBag}, the limit of ${drop.limitPerCustomer} per customer for this drop.`
          : inBag > 0
            ? `Live now. Your bag has ${inBag} of the ${drop.limitPerCustomer} allowed per customer.`
            : `Live now. Limit ${drop.limitPerCustomer} per customer across the drop.`
        : phase === "sold-out"
          ? `Sold out. Follow ${brandName} to hear about restocks and the next run.`
          : `This drop has ended. Anything left is back in ${brandName}'s shop.`

  function onClickCapture(e: React.MouseEvent) {
    if (!(e.target as Element).closest(QUICK_ADD)) return
    if (!blocked) return
    e.preventDefault()
    e.stopPropagation()
    if (phase === "upcoming") {
      toast("Not released yet", {
        description: now !== null && release !== null ? `${drop.name} opens in ${releasesIn(release - now)}. Set a reminder and we'll tell you when.` : `${drop.name} hasn't opened yet.`,
      })
    } else if (phase === "sold-out") {
      toast("Sold out", { description: `Every piece in ${drop.name} has gone.` })
    } else {
      toast("Drop limit reached", {
        description: `${drop.name} allows ${drop.limitPerCustomer} per customer, and your bag already has ${inBag}.`,
        action: { label: "View bag", onClick: () => useCart.getState().open() },
      })
    }
  }

  const split = products.length <= 2
  const grid = (
    <div
      ref={gridRef}
      onClickCapture={onClickCapture}
      data-locked={blocked ? "" : undefined}
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4",
        !split && (products.length >= 4 ? "md:grid-cols-4" : "md:grid-cols-3"),
        // Quick add shows as unavailable while the drop is closed or the limit is reached.
        "data-[locked]:[&_button[aria-label^='Quick_add']]:cursor-not-allowed data-[locked]:[&_button[aria-label^='Quick_add']]:opacity-45 data-[locked]:[&_button[aria-label^='Quick_add']]:hover:bg-transparent data-[locked]:[&_button[aria-label^='Quick_add']]:hover:text-ink",
      )}
    >
      {products.length === 1 ? (
        <ProductCard product={products[0]} variant="feature" priority className="col-span-2" />
      ) : (
        products.map((p, i) => <ProductCard key={p.id} product={p} variant={split ? "tall" : "default"} priority={i < 2} sizes={split ? "(min-width: 1024px) 30vw, 50vw" : undefined} />)
      )}
    </div>
  )

  const intro = (
    <>
      <div id="in-this-drop-title">
        <SectionHeader title="In this drop" className="mb-3 md:mb-4" />
      </div>
      <p className={cn("max-w-2xl text-[0.9375rem] leading-relaxed", phase === "live" ? "text-ink" : "text-ink-2")}>
        {until ? <span className="text-ink tabular">{until} </span> : null}
        <span id={noteId} aria-live="polite">
          {note}
        </span>
      </p>
    </>
  )

  return (
    <section id="in-this-drop" aria-labelledby="in-this-drop-title" className="mt-24 scroll-mt-28 md:mt-32">
      {split ? (
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-4">
            {intro}
            <ul className="mt-6 divide-y divide-line-soft border-y border-line-soft">
              {products.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="min-w-0 truncate text-sm text-ink">{p.name}</span>
                  <span className="shrink-0 text-xs text-ink-2">{sizeRange(p)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-8">{grid}</div>
        </div>
      ) : (
        <>
          {intro}
          <div className="mt-6 md:mt-8">{grid}</div>
        </>
      )}
    </section>
  )
}

/** "Sizes 39 to 45", "One size", "2 colours": what the shopper will choose from at release. */
function sizeRange(p: Product) {
  const size = p.options.find((o) => o.name === "Size")
  const colour = p.options.find((o) => o.name === "Colour")
  const sizes = size && size.name === "Size" ? size.values : []
  const colours = colour && colour.name === "Colour" ? colour.values.length : 0
  const sizeText = sizes.length === 0 || (sizes.length === 1 && sizes[0] === "One size") ? "One size" : sizes.length === 1 ? `Size ${sizes[0]}` : `Sizes ${sizes[0]} to ${sizes[sizes.length - 1]}`
  return colours > 1 ? `${sizeText}, ${colours} colours` : sizeText
}
