import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ProductCard } from "@/components/market/product-card"
import { ProductBreadcrumb } from "@/components/market/product/breadcrumb"
import { ProductView } from "@/components/market/product/product-view"
import { Rail } from "@/components/market/rail"
import { SectionHeader } from "@/components/market/section-header"
import { ViewBeacon } from "@/components/signals/view-beacon"
import { toCatalogProduct } from "@/lib/api/catalog-products"
import { brandById, categories, categoryBySlug, drops, products } from "@/lib/data"
import type { Brand } from "@/lib/data/types"
import { initialDropPhase } from "@/lib/drops"
import { listPublicProducts, publicProduct } from "@/server/catalog/public"
import { HttpError } from "@/server/http/errors"

/**
 * The slug is checked before anything renders so an unknown product answers with a real 404.
 * That check needs the URL, so this segment may block; every known product is prerendered.
 * The page is ad-free: both rails below the buy box are organic.
 */
export const instant = false
/**
 * The whole route is static output, so an address that wasn't prerendered waits for its own
 * render (where the check runs before anything is sent) instead of being served the shared
 * fallback shell with a 200 first.
 */
export const ensureStatic = "navigation"

export function generateStaticParams() {
  return products.filter((p) => p.status === "published").map((p) => ({ slug: p.slug }))
}

async function findProduct(slug: string) {
  try {
    const result = await publicProduct(slug)
    const product = toCatalogProduct(result.product)
    return { product, brandSummary: product.brandSummary! }
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null
    throw error
  }
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params
  const result = await findProduct(slug)
  if (!result) return { title: "Product not found" }
  const { product, brandSummary } = result
  return {
    title: `${product.name} by ${brandSummary.name}`,
    description: product.description,
    ...(product.images[0] ? { openGraph: { images: [{ url: product.images[0].src, alt: product.images[0].alt }] } } : {}),
  }
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params
  const result = await findProduct(slug)
  if (!result) notFound()
  const { product, brandSummary } = result

  const knownBrand = brandById.get(product.brandId)
  const brand: Brand = knownBrand
    ? { ...knownBrand, ...brandSummary }
    : {
        ...brandSummary,
        tagline: `Independent pieces from ${brandSummary.name}.`,
        description: "",
        story: [],
        mark: { text: brandSummary.name.slice(0, 2).toUpperCase(), style: "condensed" },
        cover: product.images[0] ?? { src: "/media/missing.svg", alt: brandSummary.name, width: 1000, height: 1250 },
        currency: product.currency,
        categories: [product.category],
        aesthetics: ["contemporary"],
        founded: new Date().getFullYear(),
        founder: { name: brandSummary.name, role: "Independent brand" },
        followers: 0,
        followerGrowth30d: 0,
        joinedAt: product.createdAt.slice(0, 10),
        social: {},
        storefront: { template: "editorial", accent: "ink", typePreset: "grotesk", intro: "", sections: [] },
        shipsFrom: brandSummary.country,
        processingDays: product.processingDays ?? [2, 5],
        returnsDays: 14,
      }
  const category = categoryBySlug.get(product.category) ?? { slug: product.category, name: categories.find((c) => c.slug === product.category)?.name ?? product.category }
  const productDrop = product.dropId ? drops.find((d) => d.id === product.dropId) : undefined
  // Only a release that hasn't ended is worth a module; the client re-checks the phase on its own clock.
  const drop = productDrop && ["upcoming", "live"].includes(initialDropPhase(productDrop)) ? productDrop : null
  const [brandResults, categoryResults] = await Promise.all([
    listPublicProducts({ brand: product.brandId, sort: "new", limit: 9, offset: 0 }),
    listPublicProducts({ category: product.category, sort: "new", limit: 24, offset: 0 }),
  ])
  const moreFromBrand = brandResults.products.filter((p) => p.id !== product.id).slice(0, 8).map(toCatalogProduct)
  const similar = categoryResults.products.filter((p) => p.id !== product.id && p.brandId !== product.brandId).slice(0, 8).map(toCatalogProduct)

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <ViewBeacon kind="product_view" productId={product.id} />
      <ProductBreadcrumb product={product} category={category} brand={brand} />

      <ProductView product={product} brand={brand} drop={drop}>
        {moreFromBrand.length ? (
          <section aria-labelledby="more-from-title" className="mt-24 md:mt-32">
            <div id="more-from-title">
              <SectionHeader title={`More from ${brand.name}`} description={brand.tagline ?? `Independent pieces from ${brand.name}.`} href={`/brands/${brand.handle}`} action="Visit storefront" />
            </div>
            <Rail label={`More from ${brand.name}`}>
              {moreFromBrand.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </Rail>
          </section>
        ) : null}

        {similar.length ? (
          <section aria-labelledby="similar-title" className="mt-24 md:mt-32">
            <div id="similar-title">
              <SectionHeader title="You might also like" description={`Pieces from other independent brands, close to this one in ${category.name.toLowerCase()} and style.`} href={`/categories/${category.slug}`} />
            </div>
            <Rail label="You might also like">
              {similar.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </Rail>
          </section>
        ) : null}
      </ProductView>
    </div>
  )
}
