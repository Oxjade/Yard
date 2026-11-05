import type { Metadata } from "next"
import { Suspense } from "react"
import { BrandDirectory, BrandDirectoryFallback } from "@/components/market/brands/brand-directory"
import { BrandSections } from "@/components/market/brands/brand-sections"
import { brands } from "@/lib/data"

export const metadata: Metadata = {
  title: "Brands",
  description: "Independent brands from Lagos to Seoul. Search, filter by category, aesthetic or location, and follow the studios you like.",
}

export default function BrandsPage() {
  const countryCount = new Set(brands.map((b) => b.country)).size
  const sections = <BrandSections />

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Brands</h1>
        <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:pb-1">
          {brands.length} independent studios from {countryCount} countries, each with its own storefront. Follow the ones you like and their new pieces, drops and stories come to you.
        </p>
      </header>

      {/* The URL holds the filters, so the directory reads it inside Suspense. The fallback is the unfiltered page. */}
      <Suspense fallback={<BrandDirectoryFallback>{sections}</BrandDirectoryFallback>}>
        <BrandDirectory>{sections}</BrandDirectory>
      </Suspense>
    </div>
  )
}
