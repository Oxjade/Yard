import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { CategoryMosaic, type CategoryTileData } from "@/components/market/catalog/category-mosaic"
import { Button } from "@/components/ui/button"
import { categories, products } from "@/lib/data"
import { publicCategories } from "@/server/catalog/public"
import { getEnv } from "@/server/env"

export const metadata: Metadata = {
  title: "Categories",
  description: "Fashion, streetwear, sneakers, jewelry, beauty, technology and more from independent brands.",
}

export default function CategoriesPage() {
  // Demo and development count the sample catalogue as before; production counts the server's
  // public products (request time) and never prints a sample number.
  const demo = getEnv().seedDemo
  const published = demo ? products.filter((p) => p.status === "published") : []
  const items: CategoryTileData[] = categories.map((category) => {
    if (!demo) return { category, pieces: null, brands: null }
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
        {demo ? (
          <CategoryMosaic items={items} />
        ) : (
          <Suspense fallback={<CategoryMosaic items={items} />}>
            <LiveMosaic fallback={items} />
          </Suspense>
        )}
      </div>

      <section aria-label="Shop everything" className="mt-24 flex flex-col items-start gap-6 border-t border-line-soft pt-10 md:mt-32 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xl font-medium text-ink">Not sure where to start?</p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-2">
            {demo ? `Browse all ${published.length} pieces at once, then narrow by brand, size, price or where the brand is from.` : "Browse everything at once, then narrow by brand, size, price or where the brand is from."}
          </p>
        </div>
        <Button asChild variant="primary" size="lg">
          <Link href="/shop">Shop everything</Link>
        </Button>
      </section>
    </div>
  )
}

/** Production: per-category counts of public products on the server; without the read, no counts at all. */
async function LiveMosaic({ fallback }: { fallback: CategoryTileData[] }) {
  await connection()
  const live = await publicCategories().then(
    (r) => r.categories,
    () => null,
  )
  if (!live) return <CategoryMosaic items={fallback} />
  const by = new Map(live.map((c) => [c.slug, c]))
  return <CategoryMosaic items={fallback.map((t) => ({ ...t, pieces: by.get(t.category.slug)?.productCount ?? 0, brands: by.get(t.category.slug)?.brandCount ?? 0 }))} />
}
