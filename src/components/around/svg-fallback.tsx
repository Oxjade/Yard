"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { cn } from "@/lib/utils"
import { landPath } from "./map/world-data"

/**
 * SvgWorldFallback (§6.4 step 10): when the browser has no WebGL (or MapLibre fails), an
 * equirectangular SVG of the same Natural Earth land with one button per city that has places.
 * It's always shown with the list, and says plainly that it's a simpler map.
 *
 * Cities closer than a 44 px button at the drawn width share one button (London and Paris on a
 * phone), so no city's button ever sits under another's.
 */
const PIN = 44
const VIEW = { y: 30, w: 1000, h: 400 }
const x = (lng: number) => ((lng + 180) / 360) * 1000
const y = (lat: number) => ((90 - lat) / 180) * 500

type CityGroup = { slug: string; city: string; lat: number; lng: number; count: number; sample: boolean }
type Cluster = { key: string; cities: CityGroup[]; count: number; sample: boolean; px: number; py: number }

export function SvgWorldFallback({ places, selectedCity, onCity, className }: { places: PlaceSummaryDto[]; selectedCity?: string | null; onCity: (citySlug: string) => void; className?: string }) {
  const [d, setD] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    let live = true
    landPath()
      .then((p) => live && setD(p))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const groups = useMemo(() => {
    const m = new Map<string, CityGroup>()
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

  // Greedy merge in screen px, biggest city first, so the result is stable for a given width.
  const clusters = useMemo(() => {
    const scale = width ? width / VIEW.w : 0
    const out: Cluster[] = []
    for (const g of [...groups].sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))) {
      const px = x(g.lng)
      const py = y(g.lat) - VIEW.y
      const hit = scale ? out.find((c) => Math.hypot((c.px - px) * scale, (c.py - py) * scale) < PIN) : undefined
      if (hit) {
        hit.px = (hit.px * hit.count + px * g.count) / (hit.count + g.count)
        hit.py = (hit.py * hit.count + py * g.count) / (hit.count + g.count)
        hit.cities.push(g)
        hit.count += g.count
        hit.sample &&= g.sample
        hit.key += `+${g.slug}`
      } else out.push({ key: g.slug, cities: [g], count: g.count, sample: g.sample, px, py })
    }
    return out
  }, [groups, width])

  const nameOf = (c: Cluster) => {
    const names = c.cities.map((g) => g.city)
    return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  }

  return (
    <figure className={cn("grid gap-2", className)}>
      <div ref={boxRef} className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b10]">
        <svg viewBox={`0 ${VIEW.y} ${VIEW.w} ${VIEW.h}`} className="block h-auto w-full" role="img" aria-label="Simplified world map with the cities that have places">
          {d ? <path d={d} fill="#1a191f" stroke="rgba(245,245,245,0.12)" strokeWidth={0.6} /> : null}
          {failed ? (
            <text x={500} y={230} textAnchor="middle" fill="#858585" fontSize={16}>
              The map outline didn&apos;t load. The list below has every place.
            </text>
          ) : null}
        </svg>
        {clusters.map((c) => {
          const selected = c.cities.some((g) => g.slug === selectedCity)
          return (
            <button
              key={c.key}
              type="button"
              // A shared button goes to the first city's section; the list below has the others right after it.
              onClick={() => onCity(c.cities[0].slug)}
              aria-pressed={selected}
              aria-label={`${nameOf(c)}, ${c.count} ${c.count === 1 ? "place" : "places"}${c.sample ? ", sample" : ""}`}
              title={nameOf(c)}
              style={{ left: `${(c.px / VIEW.w) * 100}%`, top: `${(c.py / VIEW.h) * 100}%` }}
              className={cn(
                "absolute flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card text-xs text-ink tabular ring-2 outline-none focus-visible:ring-violet",
                selected ? "ring-purple" : "ring-ink",
                c.sample && "outline-[1.5px] outline-offset-2 outline-dashed outline-ink/60",
              )}
            >
              {c.count}
            </button>
          )
        })}
      </div>
      <figcaption className="text-xs text-ink-2">Your browser can&apos;t show the 3D map, so this is a simplified one.</figcaption>
    </figure>
  )
}
