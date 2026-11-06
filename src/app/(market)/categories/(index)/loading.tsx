import { CategoryMosaicSkeleton } from "@/components/market/catalog/category-mosaic-skeleton"
import { categories } from "@/lib/data"

/**
 * Shown while /categories arrives on navigation: the real title over tiles in the mosaic's own
 * spans. It sits in the (index) group so it never wraps /categories/[slug], whose unknown slugs
 * must answer with a real 404 before anything streams.
 */
export default function CategoriesLoading() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Categories</h1>
        <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:pb-1">
          {categories.length} ways into the catalogue. Every category is made up of small, independent studios, never resellers.
        </p>
      </header>
      <div className="mt-10 md:mt-12">
        <CategoryMosaicSkeleton count={categories.length} />
      </div>
    </div>
  )
}
