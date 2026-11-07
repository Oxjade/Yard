"use client"

import Image from "next/image"
import Link from "next/link"
import { SealCheckIcon } from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import type { SponsoredDto } from "@/lib/api/contracts/charts"
import { cn } from "@/lib/utils"
import { dropStatusLabel } from "./format"

/**
 * Paid placements (§6.3 "Sponsored strip"): after rank 10, or after the list when it is shorter,
 * never inside the ranked list. They never change chart positions, and the strip says so. Each
 * placement is a short cover card (the brand card's cover with the SponsoredTag, then the mark,
 * name and Follow on a solid panel so they read on any photo), so it reads as an ad between chart
 * rows rather than as another podium.
 */
export function SponsoredStrip({ items }: { items: SponsoredDto[] }) {
  if (!items.length) return null
  // One placement runs the strip's width as photo beside its panel, so half the strip isn't empty.
  const single = items.length === 1
  return (
    <section aria-labelledby="charts-sponsored" className="my-6 rounded-lg border border-line-soft bg-surface/60 p-3 md:p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="charts-sponsored" className="text-sm font-medium text-ink">
          Sponsored
        </h2>
        <p className="text-xs text-ink-2">Paid placements. They never change chart positions.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((s) => {
          const drop = s.kind === "drop" ? s.drop : undefined
          const image = drop?.image ?? s.brand.cover
          const href = drop ? `/drops/${drop.slug}` : `/brands/${s.brand.handle}`
          return (
            <article key={drop ? `d:${drop.id}` : `b:${s.brand.id}`} className={cn("group/sp relative isolate flex flex-col overflow-hidden rounded-lg border border-line-soft bg-card", single && "sm:col-span-2 sm:flex-row")}>
              <div className={cn("relative h-24 shrink-0 overflow-hidden bg-surface md:h-28", single && "sm:h-auto sm:min-h-28 sm:w-1/2")}>
                {image ? <Image src={image.src} alt="" fill sizes="(min-width: 640px) 45vw, 90vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/sp:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/sp:scale-100" /> : null}
                <SponsoredTag className="absolute top-3 left-3" />
              </div>
              <div className={cn("flex min-w-0 items-center justify-between gap-3 border-t border-line-soft p-3", single && "sm:flex-1 sm:border-t-0 sm:border-l sm:px-5")}>
                <div className="flex min-w-0 items-center gap-2.5">
                  <BrandMark brand={s.brand} size="sm" />
                  <div className="min-w-0">
                    <Link href={href} className="flex items-center gap-1.5 text-sm font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-violet">
                      <span className="truncate">{drop ? drop.name : s.brand.name}</span>
                      {!drop && s.brand.verified ? <SealCheckIcon weight="fill" className="size-3.5 shrink-0 text-violet" aria-hidden /> : null}
                    </Link>
                    <p className="truncate text-xs text-ink-2">{drop ? `${s.brand.name}, ${dropStatusLabel[drop.status].toLowerCase()}` : `${s.brand.city}, ${s.brand.countryName}`}</p>
                  </div>
                </div>
                {drop ? null : <FollowButton brandId={s.brand.id} brandName={s.brand.name} size="xs" />}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
