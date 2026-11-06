import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { notFound } from "next/navigation"
import { CaretLeftIcon as ChevronLeft } from "@phosphor-icons/react/ssr"
import { BrandCard } from "@/components/market/brand-card"
import { BrandMark } from "@/components/market/brand-mark"
import { DropStatus } from "@/components/market/countdown"
import { DropCard } from "@/components/market/drop-card"
import { Rail } from "@/components/market/rail"
import { SectionHeader } from "@/components/market/section-header"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { isSponsoredDrop } from "@/components/market/editorial/drop-facts"
import { DropProducts } from "@/components/market/editorial/drop-products"
import { DropReleasePanel } from "@/components/market/editorial/drop-release-panel"
import { brandById, drops, getDrop, productById, upcomingDrops } from "@/lib/data"
import type { Product } from "@/lib/data/types"

/**
 * layout.tsx checks the address first, so an unknown drop answers with a real 404 and this
 * page can sit under a loading state. Every known one is prerendered below.
 */
export const instant = false

export function generateStaticParams() {
  return drops.map((d) => ({ slug: d.slug }))
}

export async function generateMetadata({ params }: PageProps<"/drops/[slug]">): Promise<Metadata> {
  const { slug } = await params
  const drop = getDrop(slug)
  if (!drop) return { title: "Drop not found" }
  const brand = brandById.get(drop.brandId)
  return { title: `${drop.name}, ${brand?.name ?? "drop"}`, description: drop.description }
}

export default async function DropPage({ params }: PageProps<"/drops/[slug]">) {
  const { slug } = await params
  const drop = getDrop(slug)
  if (!drop) notFound()

  const brand = brandById.get(drop.brandId)!
  const products = drop.productIds.map((id) => productById.get(id)).filter((p): p is Product => !!p)
  const sponsored = isSponsoredDrop(drop)
  // Other releases still to come, as Discover lists them. Live drops are on /drops, with their own card.
  const others = upcomingDrops().filter((d) => d.id !== drop.id)

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Link href="/drops" className="inline-flex min-h-10 items-center gap-1 rounded-md py-1 text-sm text-ink-2 transition-colors hover:text-ink lg:min-h-0">
        <ChevronLeft className="size-4" />
        All drops
      </Link>

      <div className="mt-5 grid gap-6 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-10">
        {/* Title block */}
        <header className="lg:col-span-8 lg:row-start-1">
          <div className="flex items-center gap-2.5">
            <BrandMark brand={brand} size="sm" />
            <Link href={`/brands/${brand.handle}`} className="text-sm text-ink transition-colors hover:text-violet">
              {brand.name}
            </Link>
          </div>
          <h1 className="mt-4 font-display text-display-lg text-balance text-ink">{drop.name}</h1>
        </header>

        {/* The photograph, with the status floating over it */}
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-card lg:col-span-8 lg:row-start-2 lg:aspect-auto lg:min-h-[620px]">
          <Image src={drop.image.src} alt={drop.image.alt} fill preload sizes="(min-width: 1024px) 64vw, 100vw" className="object-cover" />
          <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 md:top-4 md:left-4">
            <DropStatus drop={drop} />
            {sponsored ? <SponsoredTag /> : null}
          </div>
        </div>

        {/* Release panel and brand: right column on desktop, straight after the photo on phones,
            so the countdown and the one action stay in the first screen. */}
        <aside className="grid content-start gap-4 lg:col-span-4 lg:row-start-2">
          <DropReleasePanel drop={drop} brandName={brand.name} />
          {/* Phones: what the drop is, between the action and the brand (desktop has it beside the title). */}
          <p className="py-2 text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:hidden">{drop.description}</p>
          <BrandCard brand={brand} variant="row" className="border border-line-soft bg-card/40" />
        </aside>

        <p className="hidden max-w-xl text-pretty text-base leading-relaxed text-ink-2 lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:block lg:self-end">
          {drop.description}
        </p>
      </div>

      {products.length ? (
        <DropProducts drop={drop} products={products} brandName={brand.name} />
      ) : null}

      {others.length ? (
        <section aria-labelledby="more-drops-title" className="mt-24 md:mt-32">
          <div id="more-drops-title">
            <SectionHeader title="More drops" description="Other releases coming up. Set a reminder or enter the draw before each one opens." href="/drops" action="Full calendar" />
          </div>
          <Rail label="More drops" itemClassName="w-[80vw] sm:w-[46vw] md:w-[38vw] lg:w-[31%]">
            {others.map((d) => (
              <DropCard key={d.id} drop={d} />
            ))}
          </Rail>
        </section>
      ) : null}
    </div>
  )
}
