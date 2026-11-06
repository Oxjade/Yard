"use client"

import { useEffect, useMemo, useState } from "react"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { cn } from "@/lib/utils"
import { landPath } from "./map/world-data"

/**
 * SvgWorldFallback (§6.4 step 10): when the browser has no WebGL (or MapLibre fails), an
 * equirectangular SVG of the same Natural Earth land with one button per city that has places.
 * It's always shown with the list, and says plainly that it's a simpler map.
 */
export function SvgWorldFallback({ places, selectedCity, onCity, className }: { places: PlaceSummaryDto[]; selectedCity?: string | null; onCity: (citySlug: string) => void; className?: string }) {
  const [d, setD] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    landPath()
      .then((p) => live && setD(p))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  const groups = useMemo(() => {
    const m = new Map<string, { slug: string; city: string; lat: number; lng: number; count: number; sample: boolean }>()
    for (const p of places) {
      const g = m.get(p.citySlug) ?? { slug: p.citySlug, city: p.city, lat: 0, lng: 0, count: 0, sample: true }
      g.lat += p.lat
      g.lng += p.lng
      g.count += 1
      g.sample &&= p.sample
      m.set(p.citySlug, g)
    }
    return [...m.values()].map((g) => ({ ...g, lat: g.lat / g.count, lng: g.lng / g.count }))
  }, [places])

  const x = (lng: number) => ((lng + 180) / 360) * 1000
  const y = (lat: number) => ((90 - lat) / 180) * 500

  return (
    <figure className={cn("grid gap-2", className)}>
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b10]">
        <svg viewBox="0 30 1000 400" className="block h-auto w-full" role="img" aria-label="Simplified world map with the cities that have places">
          {d ? <path d={d} fill="#1a191f" stroke="rgba(245,245,245,0.12)" strokeWidth={0.6} /> : null}
          {failed ? (
            <text x={500} y={230} textAnchor="middle" fill="#858585" fontSize={16}>
              The map outline didn&apos;t load. The list below has every place.
            </text>
          ) : null}
        </svg>
        {groups.map((g) => (
          <button
            key={g.slug}
            type="button"
            onClick={() => onCity(g.slug)}
            aria-pressed={selectedCity === g.slug}
            aria-label={`${g.city}, ${g.count} ${g.count === 1 ? "place" : "places"}${g.sample ? ", sample" : ""}`}
            style={{ left: `${(x(g.lng) / 1000) * 100}%`, top: `${((y(g.lat) - 30) / 400) * 100}%` }}
            className={cn(
              "absolute flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card text-xs text-ink tabular ring-2 outline-none focus-visible:ring-violet",
              selectedCity === g.slug ? "ring-purple" : "ring-ink",
              g.sample && "outline-[1.5px] outline-offset-2 outline-dashed outline-ink/60",
            )}
          >
            {g.count}
          </button>
        ))}
      </div>
      <figcaption className="text-xs text-ink-2">Your browser can&apos;t show the 3D map, so this is a simplified one.</figcaption>
    </figure>
  )
}
