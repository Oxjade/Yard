import Image from "next/image"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react/ssr"
import { cn } from "@/lib/utils"
import type { Category } from "@/lib/data/types"
import { MOSAIC_GRID, mosaicLayout as layout } from "./category-mosaic-layout"

/**
 * The category index: one photo tile per category in an asymmetric editorial grid.
 * Phones get their own two-column composition rather than the desktop grid squeezed.
 * Spans are per position, so the composition holds as categories are added (it repeats).
 */

/** Counts are null when they aren't known (production while the server catalogue answers): the line is left out. */
export type CategoryTileData = { category: Category; pieces: number | null; brands: number | null }

export function CategoryMosaic({ items }: { items: CategoryTileData[] }) {
  return (
    <ul className={MOSAIC_GRID}>
      {items.map((item, i) => {
        const spot = layout[i % layout.length]
        return (
          <li key={item.category.slug} className={cn(spot.m, spot.d)}>
            <CategoryTile {...item} index={i} size={spot.size} phoneWide={spot.m.startsWith("col-span-2")} />
          </li>
        )
      })}
    </ul>
  )
}

function CategoryTile({ category, pieces, brands, index, size, phoneWide }: CategoryTileData & { index: number; size: "sm" | "md" | "lg"; phoneWide: boolean }) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className="group relative isolate flex h-full flex-col justify-between overflow-hidden rounded-lg bg-card p-4 transition-transform duration-150 active:scale-[0.99] md:p-6"
    >
      <Image
        src={category.image.src}
        alt=""
        fill
        preload={index < 3}
        sizes={size === "lg" ? "(min-width: 768px) 58vw, 100vw" : "(min-width: 768px) 42vw, 50vw"}
        className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]"
      />
      <span className="scrim-b absolute inset-0 -z-10" aria-hidden />
      <div className="flex justify-end">
        <span className="glass inline-flex size-9 items-center justify-center rounded-full text-ink transition-transform duration-200 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-focus-visible:translate-x-0.5 group-focus-visible:-translate-y-0.5" aria-hidden>
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <div className="min-w-0">
        {/* The index number sits in the scrimmed lower band, so it reads on light photographs too. */}
        <span className="mb-1.5 block font-display text-sm text-ink tabular" aria-hidden>
          {String(index + 1).padStart(2, "0")}
        </span>
        <h2 className={cn("font-display text-ink text-balance", phoneWide ? "text-display-md" : "text-display-sm", size === "lg" ? "md:text-display-md" : "md:text-display-sm")}>
          {category.name}
        </h2>
        {size === "lg" ? <p className="mt-2 hidden max-w-sm text-sm text-ink/80 sm:block">{category.description}</p> : null}
        {pieces === 0 ? (
          // An empty shelf while brands are joining: no "0 pieces" count.
          <p className="mt-2 text-xs text-ink/80">Coming soon</p>
        ) : pieces !== null ? (
          <p className="mt-2 text-xs text-ink/80 tabular">
            {pieces} {pieces === 1 ? "piece" : "pieces"}
            {brands !== null && pieces > 0 ? (
              <span className="hidden sm:inline">
                {" "}
                from {brands} {brands === 1 ? "brand" : "brands"}
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
    </Link>
  )
}
