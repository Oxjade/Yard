import Image from "next/image"
import { ImageBrokenIcon as ImageOff } from "@phosphor-icons/react/ssr"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import type { Campaign } from "@/lib/data/ads"
import { cn } from "@/lib/utils"
import { resolveCreative } from "./creative"
import type { PlacementRule } from "./placements"

/**
 * The creative as shoppers will see it: the image leads, and the Sponsored label is always
 * on it, in the fixed top-left position, and part of the accessible name.
 */
export function CreativePreview({ campaign, className, sizes = "220px", eager = false }: { campaign: Campaign; className?: string; sizes?: string; /** Above the fold (the first queued campaign): load at once, it is the page's largest image. */ eager?: boolean }) {
  const c = resolveCreative(campaign)
  return (
    <figure aria-label={`Sponsored: ${c.subtitle} ${c.title}`} className={cn("min-w-0", className)}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-white/8 bg-surface">
        {c.image ? (
          <Image src={c.image.src} alt={c.image.alt} fill sizes={sizes} loading={eager ? "eager" : undefined} fetchPriority={eager ? "high" : undefined} className="object-cover" />
        ) : (
          <ImageOff className="absolute inset-0 m-auto size-5 text-ink-3" aria-hidden />
        )}
        <span className="scrim-b absolute inset-x-0 bottom-0 h-1/3" aria-hidden />
        <SponsoredTag className="absolute top-2.5 left-2.5" />
      </div>
      <figcaption className="mt-2 min-w-0">
        <span className="block truncate text-[11px] text-ink-3">{c.subtitle}</span>
        <span className="block truncate text-[13px] text-ink">{c.title}</span>
      </figcaption>
    </figure>
  )
}

/**
 * A placement's slots in one view: organic cells in grey, designated sponsored cells in
 * purple (filled when booked, outlined when open).
 */
export function SlotDiagram({ rule, filled, className }: { rule: PlacementRule; filled: number; className?: string }) {
  const cells = Array.from({ length: rule.viewSize }, (_, i) => i + 1)
  const grid = rule.viewSize > 8
  const label = `${rule.positions.length === 1 ? `Position ${rule.positions[0]}` : `Positions ${rule.positions.slice(0, -1).join(", ")} and ${rule.positions.at(-1)}`} of ${rule.viewSize} ${rule.positions.length === 1 ? "is" : "are"} sponsored; ${filled} booked now. Every other position is organic.`
  return (
    <div role="img" aria-label={label} className={cn("grid gap-1", grid ? "grid-cols-12" : "", className)} style={grid ? undefined : { gridTemplateColumns: `repeat(${rule.viewSize}, minmax(0, 1fr))` }}>
      {cells.map((n) => {
        const slot = rule.positions.indexOf(n)
        const sponsored = slot >= 0
        const booked = sponsored && slot < filled
        return (
          <span
            key={n}
            className={cn(
              "flex items-center justify-center rounded-[3px] text-[9px] font-semibold tabular",
              grid ? "aspect-square" : "h-9",
              sponsored ? (booked ? "bg-purple text-ink" : "border border-dashed border-violet/70 text-violet") : "bg-white/[0.06] text-ink-3",
            )}
          >
            {sponsored ? "S" : grid ? null : n}
          </span>
        )
      })}
    </div>
  )
}
