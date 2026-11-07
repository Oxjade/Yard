"use client"

import Link from "next/link"
import { MapPinIcon } from "@phosphor-icons/react"
import type { BrandPlaceBadgeDto } from "@/lib/api/contracts/around"
import { getBrandPlaces } from "@/lib/api/around"
import { useApi } from "@/lib/api/use-api"
import { localClock, dayLabels } from "@/lib/around/hours"
import { canonicalPlacePath, kindLabel } from "@/lib/around/labels"
import { useNow } from "@/hooks/use-now"
import { cn } from "@/lib/utils"

/** "this Saturday", "today", "tomorrow" or "now", in the place's own time zone. */
function when(live: NonNullable<BrandPlaceBadgeDto["live"]>, now: number) {
  const start = Date.parse(live.startsAt)
  if (start <= now) return "on now"
  const a = localClock(now, live.timeZone).day
  const b = localClock(start, live.timeZone).day
  const days = Math.round((start - now) / 86_400_000)
  if (a === b && days < 1) return "today"
  if (days <= 1 && a !== b) return "tomorrow"
  return `this ${dayLabels[b]}`
}

export function placeBadgeText(b: BrandPlaceBadgeDto, now: number): { text: string; placeId: string; sample: boolean } | null {
  if (!b.count || !b.primary) return null
  if (b.live) {
    const lead = b.live.source === "place" ? kindLabel[b.live.kind] : "Event in store"
    return { text: `${lead} ${when(b.live, now)}`, placeId: b.live.placeId, sample: b.live.sample }
  }
  const p = b.primary
  return { text: `${kindLabel[p.kind]} in ${p.neighbourhood ?? p.city}`, placeId: p.id, sample: p.sample }
}

/**
 * PlaceBadge (§6.4 entry component, mounted by N on the storefront hero and the PDP brand row):
 * "Showroom in Ikoyi", or "Pop-up this Saturday" when a pop-up or event is live or within 7 days,
 * linking to the place on Around. A sample place adds " · sample". It renders nothing while
 * loading, on error, in a preview, or when the brand has no public places.
 */
export function PlaceBadge({ brandId, preview = false, className }: { brandId: string; preview?: boolean; className?: string }) {
  const now = useNow(60_000)
  const { data } = useApi(preview ? null : `around:badge:${brandId}`, () => getBrandPlaces(brandId), { revalidateOnFocus: false })
  if (!data || now === null) return null
  const t = placeBadgeText(data, now)
  if (!t) return null
  return (
    <Link href={canonicalPlacePath(t.placeId)} className={cn("inline-flex min-h-10 items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline md:min-h-6", className)}>
      <MapPinIcon className="size-3.5 shrink-0" aria-hidden />
      <span>{t.text}</span>
      {t.sample ? (
        <span className="text-ink-3">
          <span aria-hidden> · </span>
          <span className="sr-only">, </span>sample
        </span>
      ) : null}
    </Link>
  )
}
