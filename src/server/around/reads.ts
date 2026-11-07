import "server-only"
import { and, eq, notInArray } from "drizzle-orm"
import type { BrandPlaceBadgeDto, OnlineBrandsResult, PlaceDetailDto, PlaceSummaryDto } from "@/lib/api/contracts/around"
import { brandById } from "@/lib/data/brands"
import { db, t } from "../db"
import { aroundMemo } from "./cache"
import { toBadge, toPlaceDetail, toPlaceSummary } from "./dto"
import { eventStillPublic, publicEvents, publicPlaces, stillPublic, type PublicEventRow, type PublicPlaceRow } from "./public"

/**
 * Public reads (§6.4 Around API), all through publicPlaces(). A memo holds the rows for up to
 * 60 s; ended pop-ups, exhibitions and events are filtered out again at response time, so they
 * leave the map the moment they end, and the HTTP max-age never outlives the next ending.
 */

type Loaded = { places: PublicPlaceRow[]; events: PublicEventRow[] }

/**
 * One memo for every public read: all places publicPlaces() returns (at most 2000) and their public
 * events. Tiles, a detail id or a brand are filtered from it in memory, so no request can grow the
 * memo with keys of its own choosing.
 */
async function loadWorld(): Promise<Loaded> {
  return aroundMemo("places:world", async () => {
    const places = await publicPlaces({})
    const events = await publicEvents(places.map((p) => p.id))
    return { places, events }
  })
}

/** Seconds a response may be cached: at most `cap`, and never past the next pop-up or event end. */
function maxAgeFor(l: Loaded, now: number, cap: number) {
  let next = now + cap * 1000
  for (const p of l.places) if (p.endsAt && p.endsAt.getTime() > now) next = Math.min(next, p.endsAt.getTime())
  for (const e of l.events) if (e.endsAt.getTime() > now) next = Math.min(next, e.endsAt.getTime())
  return Math.max(0, Math.floor((next - now) / 1000))
}

function current(l: Loaded, now: number): Loaded {
  const places = l.places.filter((p) => stillPublic(p, now))
  const ids = new Set(places.map((p) => p.id))
  return { places, events: l.events.filter((e) => ids.has(e.locationId) && eventStillPublic(e, now)) }
}

function narrow(l: Loaded, keep: (p: PublicPlaceRow) => boolean): Loaded {
  const places = l.places.filter(keep)
  const ids = new Set(places.map((p) => p.id))
  return { places, events: l.events.filter((e) => ids.has(e.locationId)) }
}

export async function listPlaces(q: { tiles?: string[]; kind?: string; category?: string }): Promise<{ places: PlaceSummaryDto[]; maxAge: number }> {
  const now = Date.now()
  const all = current(await loadWorld(), now)
  const tiles = q.tiles ? new Set(q.tiles) : null
  const l = tiles ? narrow(all, (p) => tiles.has(p.tileKey ?? "")) : all
  let places = l.places
  if (q.kind) places = places.filter((p) => p.kind === q.kind)
  if (q.category) places = places.filter((p) => brandById.get(p.brandId)?.categories.includes(q.category as never))
  return {
    places: places.slice(0, q.tiles ? 500 : 2000).map((p) => toPlaceSummary(p, l.events.filter((e) => e.locationId === p.id), now)),
    maxAge: maxAgeFor(l, now, 60),
  }
}

export async function placeDetail(id: string): Promise<{ place: PlaceDetailDto; maxAge: number } | null> {
  const now = Date.now()
  const l = narrow(current(await loadWorld(), now), (p) => p.id === id)
  const p = l.places[0]
  if (!p) return null
  return { place: toPlaceDetail(p, l.events, now), maxAge: maxAgeFor(l, now, 60) }
}

export async function brandBadge(brandId: string): Promise<{ badge: BrandPlaceBadgeDto; maxAge: number }> {
  const now = Date.now()
  const l = narrow(current(await loadWorld(), now), (p) => p.brandId === brandId)
  return { badge: toBadge(l.places, l.events, now), maxAge: maxAgeFor(l, now, 300) }
}

/**
 * Brands in a city with no place publicPlaces() returns (§6.4 List view): the Online only rail.
 * Yard only knows that nothing is published, so the caption never claims they have no shop.
 */
export async function onlineBrands(citySlug: string): Promise<OnlineBrandsResult & { maxAge: number }> {
  const now = Date.now()
  const d = await db()
  const inCity = await d
    .select({ id: t.brands.id, name: t.brands.name, handle: t.brands.handle, city: t.brands.city, country: t.brands.country })
    .from(t.brands)
    .where(and(eq(t.brands.citySlug, citySlug), notInArray(t.brands.reviewStatus, ["restricted", "suspended"])))
  const l = current(await loadWorld(), now)
  const withPlaces = new Set(l.places.map((p) => p.brandId))
  const brands = inCity
    .filter((b) => !withPlaces.has(b.id))
    .map((b) => {
      const s = brandById.get(b.id)
      return { id: b.id, handle: b.handle, name: b.name, verified: s?.verified ?? false, mark: { text: s?.mark.text ?? "Y", style: s?.mark.style ?? "grotesk" }, city: b.city, country: b.country }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { city: citySlug, brands, maxAge: maxAgeFor(l, now, 60) }
}
