import type { Metadata } from "next"
import Link from "next/link"
import { CategoryMosaic } from "@/components/market/catalog/category-mosaic"
import { Button } from "@/components/ui/button"
import { categories, products } from "@/lib/data"

export const metadata: Metadata = {
  title: "Categories",
  description: "Fashion, streetwear, sneakers, jewelry, beauty, technology and more from independent brands.",
}

export default function CategoriesPage() {
  const published = products.filter((p) => p.status === "published")
  const items = categories.map((category) => {
    const inCategory = published.filter((p) => p.category === category.slug)
    return { category, pieces: inCategory.length, brands: new Set(inCategory.map((p) => p.brandId)).size }
  })

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Categories</h1>
        <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:pb-1">
          {categories.length} ways into the catalogue. Every category is made up of small, independent studios, never resellers.
        </p>
      </header>

      <div className="mt-10 md:mt-12">
        <CategoryMosaic items={items} />
      </div>

      <section aria-label="Shop everything" className="mt-24 flex flex-col items-start gap-6 border-t border-line-soft pt-10 md:mt-32 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xl font-medium text-ink">Not sure where to start?</p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-2">Browse all {published.length} pieces at once, then narrow by brand, size, price or where the brand is from.</p>
        </div>
        <Button asChild variant="primary" size="lg">
          <Link href="/shop">Shop everything</Link>
        </Button>
      </section>
    </div>
  )
}
