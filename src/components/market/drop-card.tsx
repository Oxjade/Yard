"use client"

import Image from "next/image"
import Link from "next/link"
import { brandById } from "@/lib/data/brands"
import { dropAccessLabel } from "@/lib/drops"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"
import { BrandMark } from "./brand-mark"
import { Countdown, DropStatus } from "./countdown"
import { NotifyButton } from "./notify-button"
import { SponsoredTag } from "./sponsored-tag"

export function DropCard({ drop, className, layout = "stack" }: { drop: Drop; className?: string; layout?: "stack" | "wide" }) {
  const brand = brandById.get(drop.brandId)!
  const href = `/drops/${drop.slug}`
  return (
    <article className={cn("group/drop relative flex overflow-hidden rounded-lg border border-white/8 bg-obsidian", layout === "wide" ? "flex-col md:flex-row" : "flex-col", className)}>
      <Link href={href} className={cn("relative block overflow-hidden", layout === "wide" ? "aspect-[4/3] md:aspect-auto md:w-1/2" : "aspect-[4/3]")} aria-label={drop.name}>
        <Image src={drop.image.src} alt={drop.image.alt} fill sizes="(min-width: 1024px) 33vw, 90vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/drop:scale-[1.04]" />
        <span className="absolute inset-0 bg-gradient-to-t from-obsidian/80 via-transparent to-transparent" aria-hidden />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <DropStatus drop={drop} />
          {drop.sponsored ? <SponsoredTag /> : null}
        </div>
      </Link>
      <div className={cn("flex flex-1 flex-col gap-4 p-4", layout === "wide" && "md:p-6")}>
        <div className="flex items-center gap-2">
          <BrandMark brand={brand} size="xs" />
          <Link href={`/brands/${brand.handle}`} className="relative z-10 truncate text-xs text-ink-2 hover:text-violet">{brand.name}</Link>
        </div>
        <Link href={href} className="font-display text-display-sm text-ink">{drop.name}</Link>
        <Countdown drop={drop} />
        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-ink-3">{dropAccessLabel[drop.access]}</p>
          <NotifyButton drop={drop} size="sm" />
        </div>
      </div>
    </article>
  )
}
