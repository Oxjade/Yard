import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { PackageIcon } from "@phosphor-icons/react/ssr"
import { BrandCard } from "@/components/market/brand-card"
import { ShopProductCard } from "@/components/market/editorial/use-drop-add-block"
import { SectionHeader } from "@/components/market/section-header"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { CollectionTile } from "@/components/market/editorial/collection-tile"
import { EmptyCard } from "@/components/market/editorial/empty-card"
import { Button } from "@/components/ui/button"
import { brandById, curatedCollections, diversify, getCuratedCollection, productById, products } from "@/lib/data"
import { cn } from "@/lib/utils"
import type { Brand, Product } from "@/lib/data/types"

/**
 * layout.tsx checks the address first, so an unknown edit answers with a real 404 and this
 * page can sit under a loading state. Every known one is prerendered below.
 */
export const instant = false

export function generateStaticParams() {
  return curatedCollections.map((c) => ({ slug: c.slug }))
}

export async function generateMetadata({ params }: PageProps<"/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params
  const collection = getCuratedCollection(slug)
  if (!collection) return { title: "Collection not found" }
  return { title: collection.name, description: collection.description }
}

export default async function CollectionPage({ params }: PageProps<"/collections/[slug]">) {
  const { slug } = await params
  const collection = getCuratedCollection(slug)
  if (!collection) notFound()

  const sponsor = collection.sponsoredBy ? brandById.get(collection.sponsoredBy) : undefined
  const inEdit = collection.brandIds.map((id) => brandById.get(id)).filter((b): b is Brand => !!b)
  const picks = collection.productIds.map((id) => productById.get(id)).filter((p): p is Product => !!p && p.status === "published")
  // More from the same brands, two at most per brand so no one studio takes over.
  const more = diversify(
    products
      .filter((p) => p.status === "published" && collection.brandIds.includes(p.brandId) && !collection.productIds.includes(p.id))
      .sort((a, b) => b.stats.trend - a.stats.trend),
    (p) => p.brandId,
    2,
  )
  // Whole rows only: four or eight.
  const moreRow = more.slice(0, more.length >= 8 ? 8 : 4)
  const otherEdits = curatedCollections.filter((c) => c.id !== collection.id).slice(0, 3)
  const brandHandles = inEdit.map((b) => b.handle).join(",")
  // Whole rows at desktop width: three or six brands sit in threes, everything else in fours.
  const brandCols = inEdit.length % 3 === 0 ? "lg:grid-cols-3" : "lg:grid-cols-4"

  return (
    <>
      {/* Header: the collection photograph with the title over it */}
      <header className="relative isolate overflow-hidden">
        <Image src={collection.image.src} alt="" fill preload sizes="100vw" className="-z-10 object-cover" />
        <span className="scrim-l absolute inset-0 -z-10" aria-hidden />
        <span className="scrim-b absolute inset-0 -z-10" aria-hidden />
        <div className="mx-auto flex min-h-[360px] max-w-page flex-col justify-end px-4 pt-28 pb-8 md:min-h-[460px] md:px-8 md:pb-12">
          <p className="text-sm text-ink-2">Curated collection</p>
          {sponsor ? <SponsoredTag by={sponsor.name} className="mt-4 w-fit" /> : null}
          <h1 className="mt-3 max-w-4xl font-display text-display-lg text-balance text-ink">{collection.name}</h1>
          <p className="mt-4 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink/80">{collection.description}</p>
          <p className="mt-3 text-sm text-ink-2 tabular">
            {inEdit.length} {inEdit.length === 1 ? "brand" : "brands"}, {picks.length} {picks.length === 1 ? "piece" : "pieces"}
          </p>
          {sponsor ? (
            <p className="mt-4 max-w-md text-xs leading-relaxed text-ink-2">
              {sponsor.name} sponsors this collection. Our editors chose every brand and piece; the sponsor doesn&apos;t pick what&apos;s in it.
            </p>
          ) : null}
        </div>
      </header>

      <div className="mx-auto max-w-page px-4 md:px-8">
        <section aria-labelledby="edit-brands-title" className="mt-24 md:mt-32">
          <div id="edit-brands-title">
            <SectionHeader title="Brands in this edit" />
          </div>
          {/* A swipeable row on phones, as on the category page; a grid from sm up. */}
          <div
            className={cn(
              "rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto",
              brandCols,
            )}
          >
            {inEdit.map((b) => (
              <BrandCard key={b.id} brand={b} variant="row" className="border border-line-soft bg-card/40" />
            ))}
          </div>
        </section>

        <section aria-labelledby="edit-pieces-title" className="mt-24 md:mt-32">
          <div id="edit-pieces-title">
            <SectionHeader title="The pieces" description="Chosen by our editors, one or two from each brand." />
          </div>
          {picks.length ? (
            <div className={cn("grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4", picks.length % 3 === 0 ? "md:grid-cols-3" : "md:grid-cols-4")}>
              {picks.map((p, i) => (
                <ShopProductCard key={p.id} product={p} variant={picks.length % 3 === 0 ? "default" : "tall"} priority={i < 2} />
              ))}
            </div>
          ) : (
            <EmptyCard
              icon={<PackageIcon />}
              title="The pieces in this edit are between seasons"
              reason="They're sold out or not published right now; the brands above are still open."
              action={
                <Button asChild variant="primary">
                  <Link href={`/shop?brands=${brandHandles}`}>Shop these brands</Link>
                </Button>
              }
            />
          )}
        </section>

        {moreRow.length ? (
          <section aria-labelledby="edit-more-title" className="mt-24 md:mt-32">
            <div id="edit-more-title">
              <SectionHeader title="More from these brands" description="Newer and trending pieces from the same studios." href={`/shop?brands=${brandHandles}`} action="Shop these brands" />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-4 md:grid-cols-4">
              {moreRow.map((p) => (
                <ShopProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        ) : null}

        {otherEdits.length ? (
          <section aria-labelledby="other-edits-title" className="mt-24 md:mt-32">
            <div id="other-edits-title">
              <SectionHeader title="More collections" description="Edits across brands, put together by people rather than an algorithm." />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {otherEdits.map((c) => (
                <CollectionTile key={c.id} collection={c} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}
