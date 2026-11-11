import { Suspense } from "react"
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CaretLeftIcon as ChevronLeft } from "@phosphor-icons/react/ssr"
import { BrandCard } from "@/components/market/brand-card"
import { CatalogListing } from "@/components/market/catalog/catalog-listing"
import { CatalogListingSkeleton } from "@/components/market/catalog/catalog-skeleton"
import { SectionHeader } from "@/components/market/section-header"
import { brands, categories, categoryBySlug, products } from "@/lib/data"
import type { CategorySlug } from "@/lib/data/types"
import { LiveCategoryBrands } from "@/components/market/brands/live-category-brands"
import { getEnv } from "@/server/env"

/**
 * The slug is checked before anything renders so an unknown category answers with a real 404.
 * That check needs the URL, so this segment may block; every known slug is prerendered below,
 * and the listing itself streams behind its own skeleton.
 */
export const instant = false
/**
 * The whole route is static output, so an address that wasn't prerendered waits for its own
 * render (where the check runs before anything is sent) instead of being served the shared
 * fallback shell with a 200 first.
 */
export const ensureStatic = "navigation"

export function generateStaticParams() {
  return categories.map((c) => ({ slug: c.slug }))
}

const findCategory = (slug: string) => categoryBySlug.get(slug as CategorySlug)

export async function generateMetadata({ params }: PageProps<"/categories/[slug]">): Promise<Metadata> {
  const { slug } = await params
  const category = findCategory(slug)
  if (!category) return { title: "Category not found" }
  return { title: category.name, description: category.description }
}

export default async function CategoryPage({ params }: PageProps<"/categories/[slug]">) {
  const { slug } = await params
  const category = findCategory(slug)
  if (!category) notFound()

  // Demo and development rank the sample brands as before; production reads listed brands from the
  // server in the browser (this route is static output, so no request-time read here).
  const demo = getEnv().seedDemo
  const inCategory = products.filter((p) => p.status === "published" && p.category === category.slug)
  const perBrand = new Map<string, number>()
  for (const p of inCategory) perBrand.set(p.brandId, (perBrand.get(p.brandId) ?? 0) + 1)
  const categoryBrands = (demo ? brands : [])
    .filter((b) => perBrand.has(b.id) || b.categories.includes(category.slug))
    .sort((a, b) => (perBrand.get(b.id) ?? 0) - (perBrand.get(a.id) ?? 0) || b.followers - a.followers)

  return (
    <>
      {/* Short banner: the category photograph with the title over it */}
      <header className="relative isolate overflow-hidden">
        <Image src={category.image.src} alt="" fill preload sizes="100vw" className="-z-10 object-cover" />
        <span className="scrim-l absolute inset-0 -z-10" aria-hidden />
        <span className="scrim-b absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto flex min-h-[360px] max-w-page flex-col justify-end px-4 pt-28 pb-8 md:min-h-[460px] md:px-8 md:pb-12">
          <Link href="/categories" className="-my-1.5 inline-flex min-h-10 w-fit items-center gap-1 rounded-md text-sm text-ink-2 transition-colors duration-150 hover:text-ink">
            <ChevronLeft className="size-4" />
            All categories
          </Link>
          <h1 className="mt-3 font-display text-display-lg text-ink">{category.name}</h1>
          <p className="mt-4 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink/80">{category.description}</p>
          {/* No piece count here: the listing below reads the live catalogue and shows its own count. */}
        </div>
      </header>

      <div className="mx-auto max-w-page px-4 md:px-8">
        {categoryBrands.length ? (
          <section aria-labelledby="category-brands-title" className="mt-24 md:mt-32">
            <div id="category-brands-title">
              <SectionHeader title={`Brands in ${category.name.toLowerCase()}`} href={`/brands?category=${category.slug}`} action="All brands" />
            </div>
            <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
              {categoryBrands.map((b) => (
                <BrandCard key={b.id} brand={b} variant="row" className="border border-line-soft bg-card/40" />
              ))}
            </div>
          </section>
        ) : null}
        {demo ? null : <LiveCategoryBrands category={category.slug} categoryName={category.name} />}

        <section aria-labelledby="category-listing-title" className="mt-24 md:mt-32">
          <div id="category-listing-title">
            <SectionHeader title={`All ${category.name.toLowerCase()}`} />
          </div>
          <Suspense fallback={<CatalogListingSkeleton chips={category.subcategories.length + 1} />}>
            <CatalogListing category={category.slug} />
          </Suspense>
        </section>
      </div>
    </>
  )
}
