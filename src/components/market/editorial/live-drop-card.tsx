"use client"

import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { BrandMark } from "@/components/market/brand-mark"
import { Countdown, DropStatus } from "@/components/market/countdown"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brandById } from "@/lib/data/brands"
import type { Drop } from "@/lib/data/types"
import { drawClosedRule, limitText } from "./drop-facts"
import { StockBar } from "./stock-bar"

/**
 * A drop in its live window: closing countdown, stock left and the per-customer limit. A draw
 * in its window is not open to shoppers (entries closed at release; only drawn winners buy), so
 * its card (in /drops' Entries closed group) says that once, in the rule, and links to the drop
 * page instead of showing a countdown, stock and Shop the drop.
 */
export function LiveDropCard({ drop, sponsored }: { drop: Drop; sponsored: boolean }) {
  const brand = brandById.get(drop.brandId)!
  const href = `/drops/${drop.slug}`
  const draw = drop.access === "draw"
  return (
    <article className="group/live relative grid overflow-hidden rounded-lg border border-line-soft bg-card sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* The picture is a second way to the drop for the pointer; the title is the link
          assistive tech and Tab use, so this one stays out of both. */}
      <Link href={href} tabIndex={-1} aria-hidden className="relative block aspect-[16/10] overflow-hidden sm:aspect-auto sm:min-h-[320px]">
        <Image
          src={drop.image.src}
          alt=""
          fill
          sizes="(min-width: 1024px) 22vw, (min-width: 640px) 45vw, 100vw"
          className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/live:scale-[1.04]"
        />
      </Link>
      {/* Over the picture but outside its link, so status and the sponsored disclosure are read
          and clicks pass through to the picture. */}
      <div className="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-1.5">
        <DropStatus drop={drop} />
        {sponsored ? <SponsoredTag /> : null}
      </div>
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
        {draw ? null : <Countdown drop={drop} className="mt-5" />}
        {draw ? (
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-2 sm:mt-auto sm:pt-6">{drawClosedRule}</p>
        ) : (
          <StockBar drop={drop} className="mt-6 sm:mt-auto sm:pt-6" />
        )}
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-2">{limitText(drop)}</p>
          <Button asChild size="sm" variant="secondary" className="h-10 sm:h-8">
            {draw ? <Link href={href}>Drop details</Link> : <Link href={`${href}#in-this-drop`}>Shop the drop</Link>}
          </Button>
        </div>
      </div>
    </article>
  )
}
