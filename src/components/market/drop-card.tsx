"use client"

import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { brandById } from "@/lib/data/brands"
import { dropAccessLabel, dropPhaseAt, initialDropPhase } from "@/lib/drops"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"
import { BrandMark } from "./brand-mark"
import { Countdown, DropStatus } from "./countdown"
import { NotifyButton } from "./notify-button"
import { SponsoredTag } from "./sponsored-tag"

/** The card's 32px buttons get a 40px hit area without growing (the inset counts from inside the 1px border). */
const hit = "after:absolute after:-inset-y-[5px] after:inset-x-0"

export function DropCard({
  drop,
  className,
  layout = "stack",
  eager = false,
  formatRelease,
}: {
  drop: Drop
  className?: string
  layout?: "stack" | "wide"
  /** Above the fold (e.g. a builder preview): load the image straight away. */
  eager?: boolean
  /** How the countdown writes the release time, zone included (see Countdown). */
  formatRelease?: (releaseMs: number) => string
}) {
  const brand = brandById.get(drop.brandId)!
  const href = `/drops/${drop.slug}`
  return (
    <article className={cn("group/drop relative flex overflow-hidden rounded-lg border border-white/8 bg-obsidian", layout === "wide" ? "flex-col md:flex-row" : "flex-col", className)}>
      <Link href={href} className={cn("relative block overflow-hidden", layout === "wide" ? "aspect-[4/3] md:aspect-auto md:w-1/2" : "aspect-[4/3]")} aria-label={drop.name}>
        <Image src={drop.image.src} alt={drop.image.alt} fill loading={eager ? "eager" : undefined} sizes="(min-width: 1024px) 33vw, 90vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/drop:scale-[1.04]" />
        <span className="absolute inset-0 bg-gradient-to-t from-obsidian/80 via-transparent to-transparent" aria-hidden />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <DropStatus drop={drop} />
          {drop.sponsored ? <SponsoredTag /> : null}
        </div>
      </Link>
      <div className={cn("flex flex-1 flex-col gap-4 p-4", layout === "wide" && "md:p-6")}>
        <div className="flex items-center gap-2">
          <BrandMark brand={brand} size="xs" />
          <Link href={`/brands/${brand.handle}`} className="relative z-10 min-w-0 py-3 -my-3 text-xs text-ink-2 transition-colors hover:text-violet">
            <span className="block truncate">{brand.name}</span>
          </Link>
        </div>
        <Link href={href} className="font-display text-display-sm text-ink">{drop.name}</Link>
        <Countdown drop={drop} formatRelease={formatRelease} />
        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-ink-3">{dropAccessLabel[drop.access]}</p>
          <DropAction drop={drop} href={href} />
        </div>
      </div>
    </article>
  )
}

/** The card's action follows the drop's phase: a reminder before release, the drop while it's live, nothing once it's over. */
function DropAction({ drop, href }: { drop: Drop; href: string }) {
  const now = useNow(5000)
  const phase = now === null ? initialDropPhase(drop) : dropPhaseAt(drop, now, getDemoAnchor())
  if (phase === "upcoming") return <NotifyButton drop={drop} size="sm" className={hit} />
  if (phase === "live") {
    return (
      <Button asChild size="sm" variant="secondary" className={cn("relative z-10", hit)}>
        <Link href={href}>
          Shop the drop
        </Link>
      </Button>
    )
  }
  return null
}
