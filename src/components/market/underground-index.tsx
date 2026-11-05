"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { countries } from "@/config/markets"
import { categoryBySlug } from "@/lib/data/catalog"
import type { Brand } from "@/lib/data/types"

/**
 * The Underground Index: an editorial list where the type is the design. On pointer
 * devices, hovering a row reveals the brand's cover beside it.
 */
export function UndergroundIndex({ entries }: { entries: { brand: Brand; note: string }[] }) {
  const [active, setActive] = useState<string | null>(null)
  const current = entries.find((e) => e.brand.id === active)

  return (
    <div className="relative grid gap-10 lg:grid-cols-[1fr_380px]">
      <ul className="border-t border-line-soft" onMouseLeave={() => setActive(null)}>
        {entries.map(({ brand, note }) => (
          <li key={brand.id} className="border-b border-line-soft">
            <Link
              href={`/brands/${brand.handle}`}
              onMouseEnter={() => setActive(brand.id)}
              onFocus={() => setActive(brand.id)}
              className="group grid grid-cols-1 gap-2 py-5 md:grid-cols-[1.3fr_1fr] md:items-center md:gap-8 md:py-6"
            >
              <span className="font-display text-display-md text-ink-2 transition-colors duration-300 group-hover:text-ink group-focus-visible:text-ink">
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
        ))}
      </ul>
      <div className="sticky top-28 hidden aspect-[4/5] self-start overflow-hidden rounded-xl bg-card lg:block" aria-hidden>
        <AnimatePresence mode="popLayout">
          {current ? (
            <motion.div key={current.brand.id} className="absolute inset-0" initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
              <Image src={current.brand.cover.src} alt="" fill sizes="380px" className="object-cover" />
              <span className="scrim-b absolute inset-0" />
              <p className="absolute bottom-4 left-4 right-4 text-sm text-ink">{current.brand.tagline}</p>
            </motion.div>
          ) : (
            <motion.div key="idle" className="absolute inset-0 flex items-center justify-center p-8 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="text-sm text-ink-3">Point at a name to see the studio.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
