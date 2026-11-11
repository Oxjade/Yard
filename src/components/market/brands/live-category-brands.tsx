"use client"

import { useEffect, useState } from "react"
import { SectionHeader } from "@/components/market/section-header"
import { fetchPublicBrands, type PublicBrandCard } from "@/lib/api/public-brands"
import { LiveBrandCard } from "./live-brand-card"

/**
 * Production "Brands in <category>": listed brands from the server that sell in the category
 * (GET /api/catalog/brands). The section isn't rendered at all until there is at least one, so a
 * category with no brands yet shows no empty shell (the listing below has its own empty state).
 */
export function LiveCategoryBrands({ category, categoryName }: { category: string; categoryName: string }) {
  const [list, setList] = useState<PublicBrandCard[] | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const ctrl = new AbortController()
    fetchPublicBrands({ category, sort: "new", limit: 8 }, { signal: ctrl.signal })
      .then((page) => {
        setList(page.brands)
        setMore(page.nextOffset !== null)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setList([])
      })
    return () => ctrl.abort()
  }, [category])
  if (!list?.length) return null
  return (
    <section aria-labelledby="category-brands-title" className="mt-24 md:mt-32">
      <div id="category-brands-title">
        <SectionHeader title={`Brands in ${categoryName.toLowerCase()}`} href="/brands" action={more ? "All brands" : "Browse brands"} />
      </div>
      <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
        {list.map((b) => (
          <li key={b.id} className="min-w-0">
            <LiveBrandCard brand={b} compact />
          </li>
        ))}
      </ul>
    </section>
  )
}
