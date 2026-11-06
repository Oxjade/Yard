"use client"

import Image from "next/image"
import Link from "next/link"
import { SealCheckIcon } from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import type { SponsoredDto } from "@/lib/api/contracts/charts"
import { dropStatusLabel } from "./format"

/**
 * Paid placements (§6.3 "Sponsored strip"): after rank 10, or after the list when it is shorter,
 * never inside the ranked list. They never change chart positions, and the strip says so. Each
 * placement is a short cover card (the brand card's cover, mark and Follow) that carries the
 * SponsoredTag, so it reads as an ad between chart rows rather than as another podium.
 */
export function SponsoredStrip({ items }: { items: SponsoredDto[] }) {
  if (!items.length) return null
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
            <article key={drop ? `d:${drop.id}` : `b:${s.brand.id}`} className="group/sp relative isolate h-40 overflow-hidden rounded-lg border border-line-soft bg-card md:h-44">
              {image ? <Image src={image.src} alt="" fill sizes="(min-width: 640px) 45vw, 90vw" className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover/sp:scale-[1.03]" /> : null}
              <span className="scrim-b absolute inset-0 -z-10" />
              <SponsoredTag className="absolute top-3 left-3" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <BrandMark brand={s.brand} size="sm" />
                  <div className="min-w-0">
                    <Link href={href} className="flex items-center gap-1.5 text-sm font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-violet">
                      <span className="truncate">{drop ? drop.name : s.brand.name}</span>
                      {!drop && s.brand.verified ? <SealCheckIcon weight="fill" className="size-3.5 shrink-0 text-violet" aria-hidden /> : null}
                    </Link>
                    <p className="truncate text-xs text-ink-2">{drop ? `${s.brand.name}, ${dropStatusLabel[drop.status].toLowerCase()}` : `${s.brand.city}, ${s.brand.countryName}`}</p>
                  </div>
                </div>
                {drop ? null : <FollowButton brandId={s.brand.id} brandName={s.brand.name} size="xs" variant="glass" />}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
