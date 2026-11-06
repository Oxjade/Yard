"use client"

import { memo } from "react"
import { motion } from "motion/react"
import { ProductCard } from "@/components/market/product-card"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Brand, Product } from "@/lib/data/types"
import { BrandSpotlight } from "./brand-spotlight"
import { cyclePattern, type ListingCycle, type ListingEntry } from "./catalog-state"

/**
 * The listing grid. Each page is one 24-card cycle of a repeating rhythm (see cyclePattern), so
 * a long catalogue never reads as identical blocks: standard cards, a feature band, an
 * editorial brand spotlight (browse only), a row of tall cards. Cycles are planned over the
 * whole listing before it is paged, so "Load more" only ever appends.
 */

const GRID = "grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-3"
const SIZES = "(min-width: 1024px) 25vw, (min-width: 768px) 31vw, 50vw"
const WIDE = "(min-width: 1024px) 25vw, (min-width: 768px) 31vw, 100vw"

/** Gap between appended cards; capped at one page transition so the last never waits long. */
const STAGGER = 0.03

/** Appended cards rise in once, in reading order, at the shared page timing. */
const reveal = (index: number, revealFrom: number) =>
  index >= revealFrom
    ? { initial: { opacity: 0, y: 12 }, transition: { duration: duration.page, ease: ease.out, delay: Math.min((index - revealFrom) * STAGGER, duration.page) } }
    : { initial: false as const, transition: { duration: 0 } }

type Segment =
  | { kind: "grid" | "feature" | "tall"; start: number; items: ListingEntry[]; cycle: number }
  | { kind: "spotlight"; start: number; brand: Brand; products: Product[]; cycle: number }

function segment(cycles: ListingCycle[]): Segment[] {
  const out: Segment[] = []
  cycles.forEach((cycle, c) => {
    let i = 0
    for (const step of cyclePattern) {
      if (i >= cycle.entries.length) break
      if (step.kind === "spotlight") {
        if (cycle.spotlight) out.push({ kind: "spotlight", start: cycle.start + i, ...cycle.spotlight, cycle: c })
        continue
      }
      const items = cycle.entries.slice(i, i + step.n)
      // An incomplete band at the very end of the listing falls back to standard cards.
      const kind = items.length < step.n ? "grid" : step.kind
      out.push({ kind, start: cycle.start + i, items, cycle: c })
      i += step.n
    }
  })
  return out
}

/** Memoised: the listing re-renders for its own UI state (sheet, search panel) without the cards. */
export const CatalogGrid = memo(function CatalogGrid({
  cycles,
  revealFrom,
}: {
  cycles: ListingCycle[]
  /** Cards at or after this index were just appended by "Load more" and fade in. */
  revealFrom: number
}) {
  const segments = segment(cycles)

  const cell = (entry: ListingEntry, index: number, variant: "default" | "tall" | "feature", className?: string, sizes = SIZES) => (
    <motion.div key={`${entry.item.id}-${entry.sponsored ? "s" : "o"}`} data-index={index} className={className} animate={{ opacity: 1, y: 0 }} {...reveal(index, revealFrom)}>
      <ProductCard product={entry.item} variant={variant} sponsored={entry.sponsored} priority={index < 3} sizes={sizes} />
    </motion.div>
  )

  return (
    <div className="flex flex-col gap-8">
      {segments.map((seg) => {
        if (seg.kind === "spotlight") {
          return (
            <motion.div key={`spot-${seg.brand.id}`} animate={{ opacity: 1, y: 0 }} {...reveal(seg.start, revealFrom)}>
              <BrandSpotlight brand={seg.brand} products={seg.products} flip={seg.cycle % 2 === 1} />
            </motion.div>
          )
        }
        if (seg.kind === "feature") {
          const flip = seg.cycle % 2 === 1
          const [lead, a, b] = seg.items
          return (
            <div key={`seg-${seg.start}`} className={cn(GRID, "md:grid-rows-[auto_auto]")}>
              {cell(lead, seg.start, "feature", cn("col-span-2 md:row-span-2", flip ? "md:col-start-2 md:row-start-1" : "md:col-start-1"))}
              {cell(a, seg.start + 1, "default", cn(flip ? "md:col-start-1 md:row-start-1" : "md:col-start-3 md:row-start-1"))}
              {cell(b, seg.start + 2, "default", cn(flip ? "md:col-start-1 md:row-start-2" : "md:col-start-3 md:row-start-2"))}
            </div>
          )
        }
        if (seg.kind === "tall") {
          return (
            <div key={`seg-${seg.start}`} className={GRID}>
              {seg.items.map((e, k) => (k === 0 ? cell(e, seg.start + k, "tall", "col-span-2 md:col-span-1", WIDE) : cell(e, seg.start + k, "tall")))}
            </div>
          )
        }
        return (
          <div key={`seg-${seg.start}`} className={GRID}>
            {seg.items.map((e, k) => cell(e, seg.start + k, "default"))}
          </div>
        )
      })}
    </div>
  )
})
