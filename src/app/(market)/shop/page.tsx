import { Suspense } from "react"
import type { Metadata } from "next"
import { metaDescription } from "@/lib/seo/meta"
import { CatalogListingServer } from "@/components/market/catalog/catalog-listing-server"
import { CatalogListingSkeleton } from "@/components/market/catalog/catalog-skeleton"

const title = "Shop independent brands"
const description = "Shop independent brands from around the world: fashion, streetwear, jewelry, art, beauty, home and more. Filter by category, size and price."

/**
 * /shop is one indexable page whatever its filters (canonical /shop). A search (/shop?q=…) gets its
 * own title and description, and is noindex but followed: search results are for people, while the
 * pieces they link to are each indexed on their own page.
 */
export async function generateMetadata({ searchParams }: PageProps<"/shop">): Promise<Metadata> {
  const raw = (await searchParams).q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.replace(/\s+/g, " ").trim().slice(0, 60)
  if (q) {
    return {
      title: `Search: ${q}`,
      description: metaDescription(`Pieces from independent brands on Yard matching "${q}". Filter by category, price and brand.`),
      alternates: { canonical: "/shop" },
      robots: { index: false, follow: true },
    }
  }
  return { title, description, alternates: { canonical: "/shop" }, openGraph: { url: "/shop", title, description }, twitter: { title, description } }
}

export default function ShopPage({ searchParams }: PageProps<"/shop">) {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Shop</h1>
        <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:pb-1">Explore published pieces from independent brands across Yard.</p>
      </header>
      <div className="mt-10 md:mt-12">
        {/* The listing reads the URL (useSearchParams) and its first page is read at request time, so it streams in behind this skeleton. */}
        <Suspense fallback={<CatalogListingSkeleton chips={11} />}>
          <CatalogListingServer searchParams={searchParams} structured={{ name: title, description, path: "/shop" }} />
        </Suspense>
      </div>
    </div>
  )
}
