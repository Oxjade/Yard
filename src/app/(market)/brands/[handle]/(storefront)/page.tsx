import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BrandCard } from "@/components/market/brand-card"
import { SectionHeader } from "@/components/market/section-header"
import { ViewBeacon } from "@/components/signals/view-beacon"
import { LiveStorefront } from "@/components/storefront/live-storefront"
import { brands, collectionsOf, dropsOf, getBrand, productsOf, storiesOf } from "@/lib/data"
import type { Brand } from "@/lib/data/types"

/**
 * layout.tsx checks the address first, so an unknown storefront answers with a real 404 and this
 * page can sit under a loading state. Every known one is prerendered below.
 */
export const instant = false

export function generateStaticParams() {
  return brands.map((b) => ({ handle: b.handle }))
}

export async function generateMetadata({ params }: PageProps<"/brands/[handle]">): Promise<Metadata> {
  const { handle } = await params
  const brand = getBrand(handle)
  if (!brand) return { title: "Brand not found" }
  return { title: brand.name, description: `${brand.tagline} ${brand.description}` }
}

/** Brands that share a category or an aesthetic, closest first. Organic only: storefronts are ad-free. */
function brandsLike(brand: Brand, limit = 4) {
  return brands
    .filter((b) => b.id !== brand.id)
    .map((b) => ({
      b,
      score:
        b.categories.filter((c) => brand.categories.includes(c)).length * 3 +
        b.aesthetics.filter((a) => brand.aesthetics.includes(a)).length * 2 +
        (b.country === brand.country ? 1 : 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.b.followerGrowth30d - a.b.followerGrowth30d)
    .slice(0, limit)
    .map((x) => x.b)
}

export default async function BrandStorefrontPage({ params }: PageProps<"/brands/[handle]">) {
  const { handle } = await params
  const brand = getBrand(handle)
  if (!brand) notFound()

  const similar = brandsLike(brand)

  return (
    <>
      <ViewBeacon kind="storefront_view" brandId={brand.id} />
      <LiveStorefront
        brand={brand}
        config={brand.storefront}
        products={productsOf(brand.id)}
        collections={collectionsOf(brand.id)}
        drops={dropsOf(brand.id)}
        stories={storiesOf(brand.id)}
      />

      {similar.length ? (
        <div className="mx-auto max-w-page px-4 md:px-8">
          <section aria-labelledby="similar-title" className="mt-24 md:mt-32">
            <div id="similar-title">
              <SectionHeader title="Brands like this" description={`Studios that share a category or a point of view with ${brand.name}.`} href="/brands" action="All brands" />
            </div>
            <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
              {similar.map((b) => (
                <BrandCard key={b.id} brand={b} />
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
