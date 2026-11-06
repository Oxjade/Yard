"use client"

import { useId } from "react"
import { ProductCard } from "@/components/market/product-card"
import { SectionHeader } from "@/components/market/section-header"
import { cn } from "@/lib/utils"
import type { Drop, Product } from "@/lib/data/types"
import { useDropAddBlock } from "./use-drop-add-block"
import { releasesIn } from "./use-drop-phase"

/**
 * The pieces in a drop, as ProductCards. Before release they are previews: quick add is shown
 * disabled and a tap explains when it opens. While live, adding works up to the per-customer
 * limit across the whole drop. Once sold out, adding stays closed; once ended, leftover pieces
 * are ordinary catalogue items again. The same rules hold on every other card for these pieces
 * (useDropAddBlock), so the storefront and collections never let one in early.
 */
export function DropProducts({ drop, products, brandName }: { drop: Drop; products: Product[]; brandName: string }) {
  const noteId = useId()
  const { phase, now, release, inBag, atLimit, addBlocked } = useDropAddBlock(drop, { describedBy: noteId, intervalMs: 1000, onDropPage: true })

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
          ? `Sold out. Follow ${brandName} and their next run shows up in Following.`
          : `This drop has ended. Anything left is back in ${brandName}'s shop.`

  const single = products.length === 1
  const split = products.length <= 2
  const grid = single ? (
    // One piece: the tall card in the release panel's column, not a second full-width photograph.
    <ProductCard product={withFreshLead(products[0], drop)} variant="tall" priority sizes="(min-width: 1024px) 30vw, 100vw" addBlocked={addBlocked} />
  ) : (
    <div className={cn("grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4", !split && (products.length >= 4 ? "md:grid-cols-4" : "md:grid-cols-3"))}>
      {products.map((p, i) => (
        <ProductCard key={p.id} product={withFreshLead(p, drop)} variant={split ? "tall" : "default"} priority={i < 2} sizes={split ? "(min-width: 1024px) 30vw, 50vw" : undefined} addBlocked={addBlocked} />
      ))}
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
          <div className={single ? "lg:col-span-7" : "lg:col-span-4"}>
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
          <div className={single ? "sm:max-w-sm lg:col-span-4 lg:col-start-9 lg:max-w-none" : "lg:col-span-8"}>{grid}</div>
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

/** The page's photograph is the drop image; a card showing the same one leads with the piece's next photograph instead. */
function withFreshLead(p: Product, drop: Drop): Product {
  if (p.images.length < 2 || p.images[0].src !== drop.image.src) return p
  const [first, second, ...rest] = p.images
  return { ...p, images: [second, first, ...rest] }
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
