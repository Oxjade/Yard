"use client"

import { forwardRef } from "react"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { formatDistance } from "@/lib/around/geo"
import { dayIn, timeIn } from "@/lib/around/hours"
import { kindLabel, statusLine } from "@/lib/around/labels"
import { BrandMark } from "@/components/market/brand-mark"
import { SampleChip } from "@/components/ui/sample-chip"
import { cn } from "@/lib/utils"

/** "Streetwear · Store": the brand's main category and the place's kind, as two facts. */
export function CategoryKind({ place, className }: { place: Pick<PlaceSummaryDto, "brandCategory" | "kind">; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span>{place.brandCategory}</span>
      <span aria-hidden className="text-ink-3">
        ·
      </span>
      <span className="sr-only">,</span>
      <span>{kindLabel[place.kind]}</span>
    </span>
  )
}

/** The next published event, e.g. "Drop 07: Third Mainland — in store, Sat 7 Nov". */
export function nextEventLine(p: PlaceSummaryDto, now: number) {
  const e = p.nextEvent
  if (!e) return null
  const live = Date.parse(e.startsAt) <= now
  return live ? `${e.title}, on now` : `${e.title}, ${dayIn(e.startsAt, p.timeZone)} ${timeIn(e.startsAt, p.timeZone)}`
}

export function StatusText({ place, now, className }: { place: PlaceSummaryDto; now: number; className?: string }) {
  const s = statusLine(place, now)
  if (!s) return null
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {s.live ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-acid" /> : null}
      <span className={cn("truncate", s.live && "text-ink")}>{s.text}</span>
    </span>
  )
}

type Props = {
  place: PlaceSummaryDto
  now: number
  distanceKm?: number | null
  variant?: "carousel" | "row"
  selected?: boolean
  onSelect?: () => void
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect">

/**
 * PlaceCard (§6.4): BrandMark, brand name, "{category} · {kind}" and the neighbourhood, a status
 * line, the next event, and the distance only when it's known. Sample places carry their chip.
 * `carousel` is the 248×96 glass card of the phone rail; `row` is the desktop panel's list row.
 */
export const PlaceCard = forwardRef<HTMLButtonElement, Props>(function PlaceCard({ place, now, distanceKm, variant = "row", selected = false, onSelect, className, ...rest }, ref) {
  const next = nextEventLine(place, now)
  const where = place.neighbourhood ? `${place.neighbourhood}, ${place.city}` : place.city
  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect}
      // A carousel card opens the place's sheet in one tap; `aria-current` marks the card whose pin
      // is selected on the map.
      aria-current={variant === "carousel" && selected ? "true" : undefined}
      aria-haspopup={variant === "carousel" ? "dialog" : undefined}
      aria-label={`${place.brand.name}, ${place.brandCategory} ${kindLabel[place.kind]}, ${where}${place.sample ? ", sample place" : ""}`}
      className={cn(
        "group relative flex w-full min-w-0 items-start gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-violet",
        variant === "carousel"
          ? cn("glass h-24 w-[248px] shrink-0 snap-start overflow-hidden rounded-2xl px-3 py-2.5", selected && "border-purple ring-1 ring-purple")
          : cn("rounded-xl p-2.5 transition-colors hover:bg-white/[0.05]", selected && "bg-white/[0.06]"),
        className,
      )}
      {...rest}
    >
      <BrandMark brand={place.brand} size="sm" className="mt-0.5 size-10 rounded-full text-xs" />
      <span className={cn("grid min-w-0 flex-1", variant === "carousel" ? "gap-0 leading-4" : "gap-0.5")}>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink">{place.brand.name}</span>
          {place.sample ? <SampleChip label="Sample place" className="h-4 px-1 text-[9px]" /> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
          <CategoryKind place={place} className="shrink-0" />
          {variant === "row" ? <span className="truncate">in {where}</span> : null}
        </span>
        <span className="flex min-w-0 items-center justify-between gap-2 text-xs text-ink-2">
          <StatusText place={place} now={now} />
          {distanceKm != null ? <span className="shrink-0 tabular text-ink-2">{formatDistance(distanceKm)}</span> : null}
        </span>
        {next ? <span className="truncate text-xs text-violet">{next}</span> : null}
      </span>
    </button>
  )
})
