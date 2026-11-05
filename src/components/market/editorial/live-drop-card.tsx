"use client"

import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/market/brand-mark"
import { Countdown, DropStatus } from "@/components/market/countdown"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brandById } from "@/lib/data/brands"
import type { Drop } from "@/lib/data/types"
import { limitText } from "./drop-facts"
import { StockBar } from "./stock-bar"

/** A drop that is open right now: closing countdown, stock left and the per-customer limit. */
export function LiveDropCard({ drop, sponsored }: { drop: Drop; sponsored: boolean }) {
  const brand = brandById.get(drop.brandId)!
  const href = `/drops/${drop.slug}`
  return (
    <article className="group/live grid overflow-hidden rounded-lg border border-line-soft bg-card sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <Link href={href} className="relative block aspect-[16/10] overflow-hidden sm:aspect-auto sm:min-h-[320px]" aria-label={drop.name}>
        <Image
          src={drop.image.src}
          alt={drop.image.alt}
          fill
          sizes="(min-width: 1024px) 22vw, (min-width: 640px) 45vw, 100vw"
          className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/live:scale-[1.04]"
        />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <DropStatus drop={drop} />
          {sponsored ? <SponsoredTag /> : null}
        </div>
      </Link>
      <div className="flex flex-col p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <BrandMark brand={brand} size="xs" />
          <Link href={`/brands/${brand.handle}`} className="truncate text-xs text-ink-2 transition-colors hover:text-violet">
            {brand.name}
          </Link>
        </div>
        <h3 className="mt-3 font-display text-display-sm text-ink">
          <Link href={href}>{drop.name}</Link>
        </h3>
        <Countdown drop={drop} className="mt-5" />
        <StockBar drop={drop} className="mt-6 sm:mt-auto sm:pt-6" />
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-2">{limitText(drop)}</p>
          <Button asChild size="sm" variant="secondary">
            <Link href={`${href}#in-this-drop`}>Shop the drop</Link>
          </Button>
        </div>
      </div>
    </article>
  )
}
