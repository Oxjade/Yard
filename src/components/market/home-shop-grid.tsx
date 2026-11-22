import Link from "next/link"
import { connection } from "next/server"
import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/ssr"
import { Bone, ProductCardSkeleton } from "@/components/feedback/skeletons"
import { JsonLd } from "@/components/seo/json-ld"
import { Button } from "@/components/ui/button"
import { toCatalogProduct } from "@/lib/api/catalog-products"
import { categoryBySlug } from "@/lib/data"
import type { Product } from "@/lib/data/types"
import { itemListJsonLd } from "@/lib/seo/json-ld"
import { publicOrigin } from "@/lib/seo/url"
import { listPublicProducts, publicCategories } from "@/server/catalog/public"
import { ProductCard } from "./product-card"
import { SectionHeader } from "./section-header"

/** How many pieces the home page shows: four rows on desktop, eight on phones. */
const COUNT = 16
const TITLE = "Shop new in"

const chipClass =
  "press inline-flex h-10 shrink-0 items-center rounded-full border border-line px-4 text-sm whitespace-nowrap text-ink transition-colors hover:border-ink-2/50 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-violet [--press-scale:0.96]"

/**
 * The home page's shoppable grid (production): the newest public pieces, so a visitor who lands
 * on / from a search can start shopping without finding /shop first. Server-rendered, so the
 * HTML carries real /products/… links (and an ItemList) for crawlers.
 *
 * One catalogue read, listPublicProducts: the same productPublicWhere visibility as /shop and
 * every public read (published or due, not moderated away, the brand not restricted or
 * suspended, a founding brand only once its storefront is published, never a sample brand in
 * production). Memoised in-process for 30 s and dropped on any catalogue write, so cost follows
 * time, not traffic. The category chips come from publicCategories (memoised 5 min, shared with
 * /categories and the sitemap). Renders nothing when there is nothing public, or when the read fails.
 */
export async function HomeShopGrid() {
  // Request time, outside the try: the prerender's bail-out must reach Next, not the catch below.
  await connection()
  let products: Product[] = []
  let chips: { slug: string; name: string }[] = []
  try {
    const [page, cats] = await Promise.all([listPublicProducts({ sort: "new", limit: COUNT, offset: 0 }), publicCategories().catch(() => ({ categories: [] }))])
    products = page.products.filter((p) => p.images.length > 0).map(toCatalogProduct)
    // Only categories with a public piece in them, and only ones /shop's category filter accepts.
    chips = cats.categories.filter((c) => c.productCount > 0 && categoryBySlug.has(c.slug as never)).map((c) => ({ slug: c.slug, name: c.name }))
  } catch {
    // The home page never fails for this module: without the read, it simply isn't shown.
    return null
  }
  if (!products.length) return null

  const base = publicOrigin()
  return (
    <section aria-labelledby="shop-new-title" className="mx-auto max-w-page px-4 pt-16 md:px-8 md:pt-24">
      <JsonLd nodes={[itemListJsonLd(base, products.map((p) => ({ name: p.name, path: `/products/${p.slug}`, image: p.images[0]?.src })), { name: TITLE })]} />
      <div id="shop-new-title">
        <SectionHeader title={TITLE} description="The latest pieces from independent brands on Yard, ready to order." href="/shop" action="Shop all" />
      </div>
      {chips.length > 1 ? (
        <nav aria-label="Shop by category" className="rail -mx-4 mb-8 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-2 sm:flex-wrap">
            {chips.map((c) => (
              <li key={c.slug} className="shrink-0">
                <Link href={`/shop?category=${encodeURIComponent(c.slug)}`} className={chipClass}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
        {products.map((p, i) => (
          <li key={p.id} className="min-w-0">
            <ProductCard product={p} priority={i < 2} sizes="(min-width: 768px) 22vw, 50vw" />
          </li>
        ))}
      </ul>
      <div className="mt-10 flex justify-center md:mt-12">
        <Button asChild variant="primary" size="lg">
          <Link href="/shop">
            Shop all pieces
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  )
}

/** The grid while it streams in: the header, a chip row and two rows of cards. */
export function HomeShopGridSkeleton() {
  return (
    <div role="status" aria-label="Loading pieces" className="mx-auto max-w-page px-4 pt-16 md:px-8 md:pt-24">
      <Bone className="h-10 w-56 md:h-12 md:w-72" />
      <Bone className="mt-4 mb-6 h-4 w-72 max-w-full md:mb-8" />
      <div className="mb-8 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <Bone key={i} className={i % 3 === 0 ? "h-10 w-28 shrink-0 rounded-full" : "h-10 w-20 shrink-0 rounded-full"} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
