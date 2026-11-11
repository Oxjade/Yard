import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BrandCard } from "@/components/market/brand-card"
import { SectionHeader } from "@/components/market/section-header"
import { ViewBeacon } from "@/components/signals/view-beacon"
import { LiveStorefront } from "@/components/storefront/live-storefront"
import { brands, collectionsOf, dropsOf, getBrand, productsOf, storiesOf } from "@/lib/data"
import type { Brand } from "@/lib/data/types"
import { toCatalogProduct, type PublicCatalogProduct } from "@/lib/api/catalog-products"
import { storefrontBrandFromApi, storefrontConfigFromDto, storefrontDropsFromApi, type StorefrontConfigDto } from "@/lib/api/storefront"
import { requestScope } from "@/server/auth/dal"
import { listPublicProducts, publicStorefront } from "@/server/catalog/public"
import { listPublicDrops } from "@/server/drops/service"
import { HttpError } from "@/server/http/errors"

/**
 * layout.tsx checks the address first, so an unknown storefront answers with a real 404 and this
 * page can sit under a loading state. Every known one is prerendered below.
 */
export const instant = false
/**
export function generateStaticParams() {
  return brands.map((b) => ({ handle: b.handle }))
}

export async function generateMetadata({ params }: PageProps<"/brands/[handle]">): Promise<Metadata> {
  const { handle } = await params
  const brand = getBrand(handle)
  if (brand) return { title: brand.name, description: `${brand.tagline} ${brand.description}` }
  try {
    const result = await publicStorefront(handle)
    return { title: result.brand.name, description: (result.storefront?.config?.intro as string | undefined) ?? undefined }
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return { title: "Brand not found" }
    throw error
  }
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
  const sampleBrand = getBrand(handle)
  if (!sampleBrand) {
    let data: Awaited<ReturnType<typeof publicStorefront>>
    try {
      data = await publicStorefront(handle)
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) notFound()
      throw error
    }
    await requestScope()
    const [productPage, dropPage] = await Promise.all([
      listPublicProducts({ brand: data.brand.id, limit: 60, offset: 0, sort: "new" }),
      listPublicDrops({ phase: "all", brandId: data.brand.id, limit: 50 }),
    ])
    const products = productPage.products.map((product) => toCatalogProduct(product as PublicCatalogProduct))
    const brandDto = data.brand as Parameters<typeof storefrontBrandFromApi>[0]
    const configDto = (data.storefront?.config as StorefrontConfigDto | undefined) ?? null
    const brand = storefrontBrandFromApi(brandDto, configDto, products)
    const collections = data.collections.map((collection) => ({
      id: collection.id,
      brandId: data.brand.id,
      handle: collection.handle,
      name: collection.name,
      description: collection.description,
      image: {
        src: collection.imageSrc ?? "/media/missing.svg",
        alt: collection.name,
        width: 1200,
        height: 900,
        ...(collection.imageMediaId ? { mediaId: collection.imageMediaId } : {}),
      },
      productIds: collection.productIds,
      status: "published" as const,
    }))
    const drops = storefrontDropsFromApi(dropPage.items as Parameters<typeof storefrontDropsFromApi>[0], products)
    const similar = brandsLike(brand)
    return (
      <>
        <ViewBeacon kind="storefront_view" brandId={brand.id} />
        <LiveStorefront brand={brand} config={storefrontConfigFromDto(configDto)} products={products} collections={collections} drops={drops} stories={[]} serverPublished />
        {similar.length ? (
          <div className="mx-auto max-w-page px-4 md:px-8">
            <section aria-labelledby="similar-title" className="mt-24 md:mt-32">
              <div id="similar-title">
                <SectionHeader title="Brands like this" description={`Studios that share a category or a point of view with ${brand.name}.`} href="/brands" action="All brands" />
              </div>
              <div className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
                {similar.map((b) => <BrandCard key={b.id} brand={b} />)}
              </div>
            </section>
          </div>
        ) : null}
      </>
    )
  }

  const brand = sampleBrand

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
