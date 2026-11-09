import { Suspense } from "react"
import type { Metadata } from "next"
import { CatalogListingServer } from "@/components/market/catalog/catalog-listing-server"
import { CatalogListingSkeleton } from "@/components/market/catalog/catalog-skeleton"

export const metadata: Metadata = {
  title: "Shop",
  description: "Every piece from every independent brand on the marketplace, with search, filters and sorting.",
}

export default function ShopPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Shop</h1>
        <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:pb-1">Explore published pieces from independent brands across Yard.</p>
      </header>
      <div className="mt-10 md:mt-12">
        {/* The listing reads the URL (useSearchParams) and its first page is read at request time, so it streams in behind this skeleton. */}
        <Suspense fallback={<CatalogListingSkeleton chips={11} />}>
          <CatalogListingServer />
        </Suspense>
      </div>
    </div>
  )
}
