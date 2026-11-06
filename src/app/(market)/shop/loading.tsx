import { CatalogListingSkeleton } from "@/components/market/catalog/catalog-skeleton"
import { brands, categories, products } from "@/lib/data"

/** Shown while /shop's payload arrives on navigation: the real header (static) over the listing skeleton. */
export default function ShopLoading() {
  const count = products.filter((p) => p.status === "published").length
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Shop</h1>
        <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:pb-1">
          {count} pieces from {brands.length} independent brands across {categories.length} categories, ranked by what is gaining attention this week.
        </p>
      </header>
      <div className="mt-10 md:mt-12">
        <CatalogListingSkeleton chips={categories.length + 1} />
      </div>
    </div>
  )
}
