import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BrandCard } from "@/components/market/brand-card"
import { SectionHeader } from "@/components/market/section-header"
import { ViewBeacon } from "@/components/signals/view-beacon"
import { LiveStorefront } from "@/components/storefront/live-storefront"
import { LiveBrandCard } from "@/components/market/brands/live-brand-card"
import { brands, collectionsOf, dropsOf, getBrand, productsOf, storiesOf } from "@/lib/data"
import type { PublicBrandCard } from "@/lib/api/public-brands"
import type { Brand } from "@/lib/data/types"
import { toCatalogProduct, type PublicCatalogProduct } from "@/lib/api/catalog-products"
import { storefrontBrandFromApi, storefrontConfigFromDto, storefrontDropsFromApi, type StorefrontConfigDto } from "@/lib/api/storefront"
import { requestScope } from "@/server/auth/dal"
import { listPublicBrands, listPublicProducts, publicStorefront } from "@/server/catalog/public"
import { getEnv } from "@/server/env"
import { listPublicDrops } from "@/server/drops/service"
import { HttpError } from "@/server/http/errors"

/**
 * layout.tsx checks the address first, so an unknown storefront answers with a real 404 and this
 * page can sit under a loading state. Storefronts render at request time (no generateStaticParams:
 * with Cache Components it must name at least one handle, and production has no sample handles to
 * name; an unterminated comment had also been switching generateMetadata off).
 */
export const instant = false

/** The sample brand behind a handle, only in demo and development; production reads the server alone. */
const sampleBrandFor = (handle: string) => (getEnv().seedDemo ? getBrand(handle) : undefined)

export async function generateMetadata({ params }: PageProps<"/brands/[handle]">): Promise<Metadata> {
  const { handle } = await params
  const brand = sampleBrandFor(handle)
  if (brand) return { title: brand.name, description: `${brand.tagline} ${brand.description}` }
  try {
    const result = await publicStorefront(handle)
    return { title: result.brand.name, description: (result.storefront?.config?.intro as string | undefined) ?? undefined }
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return { title: "Brand not found" }
    throw error
  }
}

/** Brands that share a category or an aesthetic, closest first (sample brands, demo only). Organic only: storefronts are ad-free. */
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

/** Up to four listed brands from the server that share a category (production "Brands like this"); none on error. */
async function liveBrandsLike(brandId: string, categories: readonly string[]): Promise<PublicBrandCard[]> {
  const out: PublicBrandCard[] = []
  try {
    for (const category of categories.slice(0, 3)) {
      if (out.length >= 4) break
      const page = await listPublicBrands({ category, exclude: brandId, sort: "new", limit: 4, offset: 0 })
      for (const b of page.brands) if (out.length < 4 && !out.some((x) => x.id === b.id)) out.push(b)
    }
  } catch {
    return []
  }
  return out
}

export default async function BrandStorefrontPage({ params }: PageProps<"/brands/[handle]">) {
  const { handle } = await params
  const sampleBrand = sampleBrandFor(handle)
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
    const configDto = (data.storefront?.config as StorefrontConfigDto | undefined) ?? null
    // The newest page lists in All products (with Load more for the rest); products a Featured
    // section names but that page doesn't hold are fetched by id, so older picks still show.
    const listed = new Set(productPage.products.map((product) => product.id))
    const named = [...new Set((configDto?.sections ?? []).flatMap((section) => section.productIds ?? []))].filter((id) => !listed.has(id))
    const namedPages = await Promise.all(
      Array.from({ length: Math.ceil(named.length / 60) }, (_, index) => listPublicProducts({ ids: named.slice(index * 60, index * 60 + 60), limit: 60, offset: 0, sort: "new" })),
    )
    const products = [...productPage.products, ...namedPages.flatMap((page) => page.products)].map((product) => toCatalogProduct(product as PublicCatalogProduct))
    const productPaging = { brandId: data.brand.id, total: productPage.total, listed: productPage.products.length, nextOffset: productPage.nextOffset }
    const brandDto = data.brand as Parameters<typeof storefrontBrandFromApi>[0]
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
    // Demo keeps ranking the sample brands; production lists real brands from the server only.
    const demo = getEnv().seedDemo
    const similar = demo ? brandsLike(brand) : []
    const similarLive = demo ? [] : await liveBrandsLike(brandDto.id, brand.categories)
    return (
      <>
        <ViewBeacon kind="storefront_view" brandId={brand.id} />
        <LiveStorefront brand={brand} config={storefrontConfigFromDto(configDto)} products={products} productPaging={productPaging} collections={collections} drops={drops} stories={[]} serverPublished />
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
        {similarLive.length ? (
          <div className="mx-auto max-w-page px-4 md:px-8">
            <section aria-labelledby="similar-title" className="mt-24 md:mt-32">
              <div id="similar-title">
                <SectionHeader title="Brands like this" description={`Studios that share a category with ${brand.name}.`} href="/brands" action="All brands" />
              </div>
              <ul className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-4">
                {similarLive.map((b) => (
                  <li key={b.id} className="min-w-0">
                    <LiveBrandCard brand={b} />
                  </li>
                ))}
              </ul>
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
