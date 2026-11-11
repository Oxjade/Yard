import Image from "next/image"
import Link from "next/link"
import { countries, type CountryCode } from "@/config/markets"
import { categoryBySlug } from "@/lib/data/catalog"
import { brandMonogram, type PublicBrandCard } from "@/lib/api/public-brands"
import { cn } from "@/lib/utils"
import { FoundingBadge, OpeningSoonTag } from "../founding-badge"

/**
 * A brand on the server (GET /api/catalog/brands): the card production shows wherever a brand is
 * listed (/brands, "Brands in …", "Brands like this", Following suggestions). The same shape as the
 * home page's founding-brand card, so a brand looks the same wherever it appears.
 */
export function LiveBrandCard({ brand: b, compact = false, className }: { brand: PublicBrandCard; compact?: boolean; className?: string }) {
  const href = `/brands/${b.handle}`
  const place = `${b.city}, ${countries[b.country as CountryCode]?.name ?? b.country}`
  const category = b.categories.map((c) => categoryBySlug.get(c as never)?.name).find(Boolean)
  return (
    <article className={cn("group/brand relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-line-soft bg-card", className)}>
      <Link href={href} className={cn("relative block overflow-hidden bg-surface", compact ? "aspect-[16/9]" : "aspect-[4/3]")} aria-hidden tabIndex={-1}>
        {b.coverSrc ? (
          <Image src={b.coverSrc} alt="" fill unoptimized sizes="(min-width: 1024px) 25vw, (min-width: 640px) 45vw, 90vw" className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/brand:scale-[1.04]" />
        ) : null}
        <span className="scrim-b absolute inset-0" />
        <span className={cn("absolute bottom-3 left-3 inline-flex items-center justify-center overflow-hidden rounded-lg border border-white/12 bg-obsidian font-display text-ink", compact ? "size-12 text-base" : "size-16 text-xl")}>
          {b.logoSrc ? <Image src={b.logoSrc} alt="" fill unoptimized sizes="64px" className="object-cover" /> : brandMonogram(b.name)}
        </span>
        {b.forSale ? null : <OpeningSoonTag className="absolute top-3 left-3" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <Link href={href} className="min-w-0 text-base font-medium text-ink transition-colors hover:text-violet">
          <span className="block truncate">{b.name}</span>
        </Link>
        <p className="-mt-1 truncate text-xs text-ink-2">
          {place}
          {category ? ` · ${category}` : ""}
        </p>
        {b.foundingBadge ? <FoundingBadge compact className="w-fit" /> : null}
        {!compact && b.story ? <p className="line-clamp-2 text-sm leading-relaxed break-words text-ink-2">{b.story}</p> : null}
      </div>
    </article>
  )
}
