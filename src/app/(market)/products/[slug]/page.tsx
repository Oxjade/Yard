import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ProductCard } from "@/components/market/product-card"
import { ProductBreadcrumb } from "@/components/market/product/breadcrumb"
import { ProductView } from "@/components/market/product/product-view"
import { Rail } from "@/components/market/rail"
import { SectionHeader } from "@/components/market/section-header"
import { ViewBeacon } from "@/components/signals/view-beacon"
import { brandById, categoryBySlug, drops, getProduct, products, productsOf, similarProducts } from "@/lib/data"
import { initialDropPhase } from "@/lib/drops"

/**
 * The slug is checked before anything renders so an unknown product answers with a real 404.
 * That check needs the URL, so this segment may block; every known product is prerendered.
 * The page is ad-free: both rails below the buy box are organic.
 */
export const instant = false

export function generateStaticParams() {
  return products.filter((p) => p.status === "published").map((p) => ({ slug: p.slug }))
}

const findProduct = (slug: string) => {
  const product = getProduct(slug)
  return product && product.status === "published" ? product : undefined
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params
  const product = findProduct(slug)
  if (!product) return { title: "Product not found" }
  const brand = brandById.get(product.brandId)!
  return {
    title: `${product.name} by ${brand.name}`,
    description: product.description,
    openGraph: { images: [{ url: product.images[0].src, alt: product.images[0].alt }] },
  }
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params
  const product = findProduct(slug)
  if (!product) notFound()

  const brand = brandById.get(product.brandId)!
  const category = categoryBySlug.get(product.category)!
  const productDrop = product.dropId ? drops.find((d) => d.id === product.dropId) : undefined
  // Only a release that hasn't ended is worth a module; the client re-checks the phase on its own clock.
  const drop = productDrop && ["upcoming", "live"].includes(initialDropPhase(productDrop)) ? productDrop : null
  const moreFromBrand = productsOf(brand.id).filter((p) => p.id !== product.id).slice(0, 8)
  const similar = similarProducts(product, 8)

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <ViewBeacon kind="product_view" productId={product.id} />
      <ProductBreadcrumb product={product} category={category} brand={brand} />

      <ProductView product={product} brand={brand} drop={drop}>
        {moreFromBrand.length ? (
          <section aria-labelledby="more-from-title" className="mt-24 md:mt-32">
            <div id="more-from-title">
              <SectionHeader title={`More from ${brand.name}`} description={brand.tagline} href={`/brands/${brand.handle}`} action="Visit storefront" />
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
