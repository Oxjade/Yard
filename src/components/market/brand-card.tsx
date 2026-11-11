"use client"

import Image from "next/image"
import Link from "next/link"
import { SealCheckIcon as BadgeCheck } from "@phosphor-icons/react"
import { countries } from "@/config/markets"
import { products } from "@/lib/data/products"
import { formatNumber } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { Brand } from "@/lib/data/types"
import { RankBadge } from "@/components/charts/entry/rank-badge"
import { BrandMark } from "./brand-mark"
import { FoundingBadge } from "./founding-badge"
import { FollowButton } from "./follow-button"
import { SponsoredTag } from "./sponsored-tag"

/**
 * Brand cards. A brand is a destination, so the card leads with its cover and mark,
 * then where it's from — the two things people use to place an unknown brand.
 */
export function BrandCard({
  brand,
  variant = "cover",
  sponsored = false,
  showProducts = false,
  stat,
  className,
}: {
  brand: Brand
  variant?: "cover" | "row"
  sponsored?: boolean
  showProducts?: boolean
  stat?: "growth" | "followers" | "joined"
  className?: string
}) {
  const href = `/brands/${brand.handle}`
  const place = `${brand.city}, ${countries[brand.country].name}`
  const statText =
    stat === "growth"
      ? `+${Math.round(brand.followerGrowth30d * 100)}% followers in 30 days`
      : stat === "joined"
        ? `Joined ${new Date(brand.joinedAt).toLocaleDateString("en-GB", { month: "long", day: "numeric", timeZone: "UTC" })}`
        : `${formatNumber(brand.followers, { compact: true })} followers`

  if (variant === "row") {
    return (
      // The mark is part of the link, so the whole left of the row (44px tall) opens the brand;
      // Follow keeps its compact look with a 40px tap area (see FollowButton).
      <div className={cn("group/brand flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-card", className)}>
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 rounded-md">
          <BrandMark brand={brand} size="md" />
          <span className="min-w-0">
            <span className="block truncate text-sm text-ink">{brand.name}</span>
            <span className="block truncate text-xs text-ink-2">{place}</span>
          </span>
        </Link>
        <FollowButton brandId={brand.id} brandName={brand.name} size="xs" />
      </div>
    )
  }

  const thumbs = showProducts ? products.filter((p) => p.brandId === brand.id).slice(0, 3) : []

  return (
    <article className={cn("group/brand relative flex flex-col overflow-hidden rounded-lg border border-line-soft bg-card", className)}>
      {/* The cover is a second, mouse-only way in; the name link below is the one Tab and screen readers use. */}
      <div className="relative">
        <Link href={href} className="relative block aspect-[4/3] overflow-hidden" aria-hidden tabIndex={-1}>
          <Image
            src={brand.cover.src}
            alt=""
            fill
            sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw"
            className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/brand:scale-[1.04]"
          />
          <span className="scrim-b absolute inset-0" />
          <BrandMark brand={brand} size="lg" className="absolute bottom-3 left-3" />
        </Link>
        {sponsored ? <SponsoredTag className="pointer-events-none absolute top-3 left-3" /> : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={href} className="flex items-center gap-1.5 text-base font-medium text-ink">
              <span className="truncate">{brand.name}</span>
              {brand.verified ? <BadgeCheck className="size-4 shrink-0 text-violet" aria-label="Verified brand" /> : null}
            </Link>
            <p className="mt-0.5 truncate text-xs text-ink-2">{place}</p>
            {brand.foundingBadge ? <FoundingBadge compact className="mt-1.5" /> : null}
            {/* Its best weekly chart position, when it has one (§7.4); text only, since the card's name is the link. */}
            <RankBadge brandId={brand.id} variant="meta" asLink={false} className="mt-1 text-xs" />
          </div>
          <FollowButton brandId={brand.id} brandName={brand.name} size="xs" />
        </div>
        <p className="line-clamp-2 text-sm leading-relaxed text-ink-2">{brand.tagline}</p>
        {thumbs.length ? (
          <div className="mt-auto grid grid-cols-3 gap-1.5">
            {thumbs.map((p) => (
              <Link key={p.id} href={`/products/${p.slug}`} className="relative aspect-square overflow-hidden rounded-md bg-surface">
                <Image src={p.images[0].src} alt={p.images[0].alt} fill sizes="120px" className="object-cover transition-transform duration-500 hover:scale-105" />
              </Link>
            ))}
          </div>
        ) : null}
        <p className={cn("text-xs tabular", stat === "growth" ? "text-violet" : "text-ink-3", !thumbs.length && "mt-auto")}>{statText}</p>
      </div>
    </article>
  )
}
