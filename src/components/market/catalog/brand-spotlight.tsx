"use client"

import Image from "next/image"
import Link from "next/link"
import { BadgeCheck } from "lucide-react"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { ProductCard } from "@/components/market/product-card"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { storiesOf } from "@/lib/data"
import type { Brand, Product } from "@/lib/data/types"

/**
 * An editorial break in the grid: one brand from the current results, chosen by how much of
 * its page it makes up. Earned, never paid, so it carries no sponsored label. Its pieces are
 * ones the listing has not shown yet (they leave their later spot); without any, no row shows.
 */
export function BrandSpotlight({ brand, products, flip = false }: { brand: Brand; products: Product[]; flip?: boolean }) {
  const story = storiesOf(brand.id)[0]
  const href = `/brands/${brand.handle}`
  return (
    <aside aria-label={`Brand spotlight: ${brand.name}`} className="overflow-hidden rounded-lg border border-line-soft bg-card">
      <div className={`grid md:grid-cols-2 ${flip ? "md:[&>*:first-child]:order-2" : ""}`}>
        <Link href={href} className="group relative block aspect-[4/3] overflow-hidden md:aspect-auto md:min-h-[420px]" aria-label={`${brand.name} storefront`}>
          <Image
            src={brand.cover.src}
            alt={brand.cover.alt}
            fill
            sizes="(min-width: 1024px) 38vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]"
          />
          <span className="scrim-b absolute inset-0" aria-hidden />
          <BrandMark brand={brand} size="lg" className="absolute bottom-4 left-4" />
        </Link>
        <div className="flex flex-col p-5 md:p-8">
          <p className="text-xs text-violet">Brand spotlight</p>
          <h3 className="mt-2 flex items-center gap-2 font-display text-display-sm text-ink">
            <Link href={href}>{brand.name}</Link>
            {brand.verified ? <BadgeCheck className="size-5 shrink-0 text-violet" aria-label="Verified brand" /> : null}
          </h3>
          <p className="mt-1 text-sm text-ink-2">
            {brand.city}, {countries[brand.country].name}. Since {brand.founded}.
          </p>
          <p className="mt-4 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{brand.tagline}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <FollowButton brandId={brand.id} brandName={brand.name} />
            <Button asChild variant="secondary" size="sm">
              <Link href={href}>Visit storefront</Link>
            </Button>
            {story ? (
              <Link href={`/stories/${story.slug}`} className="text-sm text-violet underline-offset-4 hover:underline sm:ml-2">
                Read their story
              </Link>
            ) : null}
          </div>
          {products.length ? (
            <div className="mt-6 grid grid-cols-2 gap-3 md:mt-auto md:pt-8">
              {products.slice(0, 2).map((p) => (
                <ProductCard key={p.id} product={p} variant="compact" sizes="(min-width: 1024px) 17vw, (min-width: 768px) 22vw, 45vw" />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
