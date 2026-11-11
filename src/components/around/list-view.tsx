"use client"

import Link from "next/link"
import { useMemo } from "react"
import { StorefrontIcon } from "@phosphor-icons/react"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { getOnlineBrands } from "@/lib/api/around"
import { useApi } from "@/lib/api/use-api"
import { haversineKm } from "@/lib/around/geo"
import { brandById } from "@/lib/data/brands"
import { usePageSampleData } from "@/components/sample/sample-data-context"
import { BrandCard } from "@/components/market/brand-card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { soonKey } from "./filters-model"
import { PlaceCard } from "./place-card"

export type SortKey = "distance" | "soon" | "az"

/** A radiogroup of sort options where one can be disabled with a reason (the insight Segmented can't). */
export function SortControl({ value, onChange, distanceEnabled }: { value: SortKey; onChange: (v: SortKey) => void; distanceEnabled: boolean }) {
  const options: { value: SortKey; label: string; disabled?: boolean }[] = [
    { value: "distance", label: "Distance", disabled: !distanceEnabled },
    { value: "soon", label: "Happening soon" },
    { value: "az", label: "A–Z" },
  ]
  return (
    <div className="grid gap-1">
      <div role="radiogroup" aria-label="Sort places" className="inline-flex max-w-full items-center gap-0.5 justify-self-start rounded-full border border-white/[0.08] bg-white/[0.02] p-[3px]">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={o.disabled}
              title={o.disabled ? "Share your location or pick an area to sort by distance." : undefined}
              onClick={() => onChange(o.value)}
              className={cn("h-9 rounded-full px-3.5 text-[13px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:text-xs", on ? "bg-purple text-ink" : "text-ink-2 hover:text-ink")}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {!distanceEnabled ? <p className="text-xs text-ink-2">Distance needs your location or an area.</p> : null}
    </div>
  )
}

export function sortPlaces(list: PlaceSummaryDto[], sort: SortKey, now: number, origin: { lat: number; lng: number } | null) {
  const out = [...list]
  if (sort === "az") out.sort((a, b) => a.brand.name.localeCompare(b.brand.name) || a.name.localeCompare(b.name))
  else if (sort === "soon") out.sort((a, b) => soonKey(a, now) - soonKey(b, now) || a.brand.name.localeCompare(b.brand.name))
  else if (origin) out.sort((a, b) => haversineKm(origin.lat, origin.lng, a.lat, a.lng) - haversineKm(origin.lat, origin.lng, b.lat, b.lng))
  return out
}

/**
 * List view (`?view=list`, §6.4): places grouped by city (the chosen city first), a sort, the
 * filter chips above it, and at the end the Online only rail for the chosen city: brands with no
 * place on Around. Yard only knows nothing is published, so the caption never claims more.
 */
export function ListView({
  places,
  loading,
  error,
  onRetry,
  now,
  origin,
  city,
  sort,
  onSort,
  distanceEnabled,
  onOpen,
  header,
  onClearFilters,
  filtered,
}: {
  places: PlaceSummaryDto[]
  loading: boolean
  error: unknown
  onRetry: () => void
  now: number
  origin: { lat: number; lng: number } | null
  city: { slug: string; name: string } | null
  sort: SortKey
  onSort: (s: SortKey) => void
  distanceEnabled: boolean
  onOpen: (id: string) => void
  header?: React.ReactNode
  onClearFilters?: () => void
  filtered: boolean
}) {
  const groups = useMemo(() => {
    const by = new Map<string, { slug: string; name: string; places: PlaceSummaryDto[] }>()
    for (const p of sortPlaces(places, sort, now, origin)) {
      const g = by.get(p.citySlug) ?? { slug: p.citySlug, name: p.city, places: [] }
      g.places.push(p)
      by.set(p.citySlug, g)
    }
    const list = [...by.values()]
    list.sort((a, b) => {
      if (city && a.slug === city.slug) return -1
      if (city && b.slug === city.slug) return 1
      if (origin) return haversineKm(origin.lat, origin.lng, a.places[0].lat, a.places[0].lng) - haversineKm(origin.lat, origin.lng, b.places[0].lat, b.places[0].lng)
      return a.name.localeCompare(b.name)
    })
    if (city && !by.has(city.slug)) list.unshift({ slug: city.slug, name: city.name, places: [] })
    return list
  }, [places, sort, now, origin, city])

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 px-4 pt-24 pb-[calc(var(--tabbar-clear,6.25rem)+1rem)] lg:pt-28 lg:pb-12">
      {header}
      <SortControl value={sort} onChange={onSort} distanceEnabled={distanceEnabled} />
      {error && !places.length ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-4">
          <p className="text-sm text-ink">Couldn&apos;t load places.</p>
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : loading && !places.length ? (
        <div role="status" aria-label="Loading places" className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skeleton block h-20 rounded-xl" />
          ))}
        </div>
      ) : null}
      {!loading && !error && !places.length && filtered ? (
        <div className="grid justify-items-start gap-3 rounded-xl border border-dashed border-white/12 p-5">
          <p className="text-sm text-ink">No places match these filters.</p>
          {onClearFilters ? (
            <Button size="sm" variant="secondary" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
      {groups.map((g) => (
        <section key={g.slug} aria-labelledby={`city-${g.slug}`} className="grid gap-2">
          <h2 id={`city-${g.slug}`} className="font-display text-2xl text-ink">
            {g.name}
            <span className="ml-2 align-middle font-sans text-xs text-ink-2 tabular">{g.places.length === 1 ? "1 place" : `${g.places.length} places`}</span>
          </h2>
          {g.places.length ? (
            <ul className="grid gap-1">
              {g.places.map((p) => (
                <li key={p.id}>
                  <PlaceCard place={p} now={now} distanceKm={origin ? haversineKm(origin.lat, origin.lng, p.lat, p.lng) : null} onSelect={() => onOpen(p.id)} className="border border-white/[0.06]" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">No places in {g.name} on Yard Around yet.</p>
          )}
          {city && g.slug === city.slug ? <OnlineOnly city={city} /> : null}
        </section>
      ))}
      {!city ? <p className="text-xs text-ink-2">Pick a city to see the brands there that sell online only.</p> : null}
    </div>
  )
}

function OnlineOnly({ city }: { city: { slug: string; name: string } }) {
  const { data, error, revalidate } = useApi(`around:online:${city.slug}`, () => getOnlineBrands(city.slug))
  // Demo shows the sample brand cards; production renders the server's brands as they come (the
  // sample map knows none of them, so mapping through it used to drop every real brand).
  const demo = usePageSampleData()
  const brands = demo ? (data?.brands ?? []).map((b) => brandById.get(b.id)).filter((b): b is NonNullable<typeof b> => !!b) : []
  const live = demo ? [] : (data?.brands ?? [])
  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3">
        <p className="text-xs text-ink-2">Couldn&apos;t load the brands in {city.name} that sell online only.</p>
        <Button size="sm" variant="ghost" onClick={() => void revalidate()}>
          Retry
        </Button>
      </div>
    )
  }
  if (!data || !(brands.length || live.length)) return null
  return (
    <aside aria-labelledby={`online-${city.slug}`} className="mt-3 grid gap-2 rounded-2xl border border-white/[0.08] p-3">
      <div className="flex items-center gap-2">
        <StorefrontIcon className="size-4 text-ink-2" aria-hidden />
        <h3 id={`online-${city.slug}`} className="text-sm font-medium text-ink">
          Online only in {city.name}
        </h3>
      </div>
      <p className="text-xs text-ink-2">No places on Yard Around yet — shop online.</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {brands.map((b) => (
          <li key={b.id}>
            <BrandCard brand={b} variant="row" />
          </li>
        ))}
        {live.map((b) => (
          <li key={b.id} className="min-w-0">
            <Link href={`/brands/${b.handle}`} className="flex min-w-0 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-white/[0.04]">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-obsidian font-display text-sm text-ink" aria-hidden>
                {b.mark.text}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-ink">{b.name}</span>
                <span className="block truncate text-xs text-ink-2">{b.city}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}
