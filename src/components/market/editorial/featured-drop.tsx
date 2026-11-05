import Image from "next/image"
import Link from "next/link"
import { BrandMark } from "@/components/market/brand-mark"
import { Countdown, DropStatus } from "@/components/market/countdown"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brandById } from "@/lib/data"
import type { Drop } from "@/lib/data/types"
import { DropPrimaryAction } from "./drop-actions"
import { accessName, accessRule, runText } from "./drop-facts"

/**
 * The lead release on /drops: photograph on the left, a quiet card panel on the right with the
 * countdown, the rules and the one main action (acid). Discover's band is the site's large
 * purple surface, so this module stays on the card surface; purple is kept for the smaller
 * release panel on the drop page itself.
 */
export function FeaturedDrop({ drop, sponsored }: { drop: Drop; sponsored: boolean }) {
  const brand = brandById.get(drop.brandId)!
  const href = `/drops/${drop.slug}`
  return (
    <article aria-labelledby="featured-drop-title" className="grid overflow-hidden rounded-lg border border-line-soft bg-card md:grid-cols-12">
      <Link href={href} className="group/feature relative block aspect-[4/3] overflow-hidden bg-surface md:col-span-7 md:aspect-auto md:min-h-[600px]" aria-label={drop.name}>
        <Image
          src={drop.image.src}
          alt={drop.image.alt}
          fill
          priority
          sizes="(min-width: 768px) 58vw, 100vw"
          className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/feature:scale-[1.03]"
        />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 md:top-4 md:left-4">
          <DropStatus drop={drop} />
          {sponsored ? <SponsoredTag /> : null}
        </div>
      </Link>

      <div className="flex flex-col p-5 sm:p-6 md:col-span-5 md:p-8 lg:p-10">
        <div className="flex items-center gap-2.5">
          <BrandMark brand={brand} size="sm" />
          <Link href={`/brands/${brand.handle}`} className="truncate text-sm text-ink transition-colors hover:text-violet">
            {brand.name}
          </Link>
          <span className="truncate text-sm text-ink-3">{brand.city}</span>
        </div>
        <h2 id="featured-drop-title" className="mt-6 font-display text-display-md text-balance text-ink md:mt-8">
          <Link href={href} className="transition-colors hover:text-violet">
            {drop.name}
          </Link>
        </h2>
        <p className="mt-4 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{drop.description}</p>

        <Countdown drop={drop} size="lg" className="mt-8 text-ink md:mt-auto md:pt-10" />

        <dl className="mt-8 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line-soft pt-5 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-ink-2">Release type</dt>
            <dd className="mt-1 text-ink">{accessName[drop.access]}</dd>
            <dd className="mt-1 text-xs leading-relaxed text-ink-2">{accessRule[drop.access]}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Limit</dt>
            <dd className="mt-1 text-ink tabular">{drop.limitPerCustomer} per customer</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Run</dt>
            <dd className="mt-1 text-ink tabular">{runText(drop)}</dd>
          </div>
        </dl>

        <div className="mt-7">
          <DropPrimaryAction drop={drop} size="lg" />
        </div>
      </div>
    </article>
  )
}
