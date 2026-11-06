"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { countries } from "@/config/markets"
import { categoryBySlug } from "@/lib/data/catalog"
import type { Brand } from "@/lib/data/types"
import { cn } from "@/lib/utils"

/**
 * The Underground Index: an editorial list where the type is the design. Beside it on wide
 * screens, the studio's cover: the first entry's until a row is pointed at or focused, then that
 * row's, and it stays on the last one chosen. The covers are stacked and cross-fade (opacity
 * only), so a swap never waits on an image that hasn't loaded yet.
 */
export function UndergroundIndex({ entries }: { entries: { brand: Brand; note: string }[] }) {
  const [active, setActive] = useState<string | null>(null)
  const current = entries.find((e) => e.brand.id === active) ?? entries[0]

  return (
    <div className="relative grid gap-10 lg:grid-cols-[1fr_380px]">
      <ul className="border-t border-line-soft">
        {entries.map(({ brand, note }) => {
          const on = brand.id === current?.brand.id
          return (
            <li key={brand.id} className="border-b border-line-soft">
              <Link
                href={`/brands/${brand.handle}`}
                onMouseEnter={() => setActive(brand.id)}
                onFocus={() => setActive(brand.id)}
                className="group grid grid-cols-1 gap-2 py-5 md:grid-cols-[1.3fr_1fr] md:items-center md:gap-8 md:py-6"
              >
                {/* Where the cover shows (wide screens), its studio's name is lit, so the two read together. */}
                <span className={cn("font-display text-display-md text-ink-2 transition-colors duration-200 group-hover:text-ink group-focus-visible:text-ink", on && "lg:text-ink")}>
                  {brand.name}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-baseline gap-x-3 text-sm">
                    <span className="text-ink transition-colors group-hover:text-violet">{brand.city}, {countries[brand.country].name}</span>
                    <span className="text-ink-3">{categoryBySlug.get(brand.categories[0])?.name}</span>
                  </span>
                  <span className="text-pretty text-sm text-ink-2">{note}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
      <div className="sticky top-28 hidden aspect-[4/5] self-start overflow-hidden rounded-xl bg-card lg:block" aria-hidden>
        {entries.map(({ brand }) => {
          const on = brand.id === current?.brand.id
          return (
            <div key={brand.id} className={cn("absolute inset-0 transition-opacity duration-300 ease-out-quint", on ? "opacity-100" : "opacity-0")}>
              <Image src={brand.cover.src} alt="" fill sizes="380px" className="object-cover" />
              <span className="scrim-b absolute inset-0" />
              <p className="absolute right-4 bottom-4 left-4 text-sm text-ink">{brand.tagline}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
