import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { haversineKm } from "@/lib/around/geo"
import { isOpenNow, type LocationKind } from "@/lib/around/labels"
import { timedStatus } from "@/lib/around/hours"

/**
 * Around's filters (§6.4). Kind and category live in the URL (`?kind=`, `?cat=`); Open now,
 * This week and the distance cap are per-visit. Everything is applied on this device.
 */

export type KindKey = LocationKind | "events" | "offers"
export const KIND_KEYS: KindKey[] = ["store", "showroom", "popup", "events", "offers"]
export const kindFilterLabel: Record<KindKey, string> = {
  store: "Stores",
  showroom: "Showrooms",
  popup: "Pop-ups",
  exhibition: "Exhibitions",
  events: "Exhibitions & events",
  offers: "Drops & offers",
}
export const DISTANCES = [1, 5, 10, 25] as const
export type Distance = (typeof DISTANCES)[number]

export type Filters = { kinds: KindKey[]; cats: string[]; openNow: boolean; thisWeek: boolean; within: Distance | null }
export const emptyFilters: Filters = { kinds: [], cats: [], openNow: false, thisWeek: false, within: null }

export const parseList = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [])
export const parseKinds = (v: string | null) => parseList(v).filter((k): k is KindKey => (KIND_KEYS as string[]).includes(k) || k === "exhibition")

export function activeCount(f: Filters) {
  return f.kinds.length + f.cats.length + (f.openNow ? 1 : 0) + (f.thisWeek ? 1 : 0) + (f.within ? 1 : 0)
}

const WEEK = 7 * 86_400_000

function matchesKind(p: PlaceSummaryDto, k: KindKey, now: number) {
  switch (k) {
    case "store":
    case "showroom":
    case "popup":
    case "exhibition":
      return p.kind === k
    case "events":
      return p.kind === "exhibition" || !!p.nextEvent
    case "offers":
      return p.offer
  }
  void now
}

/** Something happening in the next 7 days: a dated place or an event overlapping the week. */
export function happeningThisWeek(p: PlaceSummaryDto, now: number) {
  const overlaps = (s: string | null | undefined, e: string | null | undefined) => !!s && !!e && Date.parse(s) < now + WEEK && Date.parse(e) > now
  return overlaps(p.startsAt, p.endsAt) || overlaps(p.nextEvent?.startsAt, p.nextEvent?.endsAt)
}

export function applyFilters(places: PlaceSummaryDto[], f: Filters, now: number, origin: { lat: number; lng: number } | null) {
  return places.filter((p) => {
    if (f.kinds.length && !f.kinds.some((k) => matchesKind(p, k, now))) return false
    if (f.cats.length && !f.cats.some((c) => p.brandCategories.includes(c))) return false
    if (f.openNow && !isOpenNow(p, now)) return false
    if (f.thisWeek && !happeningThisWeek(p, now)) return false
    if (f.within && origin && haversineKm(origin.lat, origin.lng, p.lat, p.lng) > f.within) return false
    return true
  })
}

/** "Happening soon": live first, then by the next start (a dated place or its next event); plain stores last. */
export function soonKey(p: PlaceSummaryDto, now: number) {
  const st = timedStatus(p.startsAt, p.endsAt, now)
  if (st === "live") return 0
  const times = [p.startsAt && st === "upcoming" ? Date.parse(p.startsAt) : null, p.nextEvent ? Math.max(now, Date.parse(p.nextEvent.startsAt)) : null].filter((x): x is number => x !== null)
  return times.length ? Math.min(...times) - now + 1 : Number.MAX_SAFE_INTEGER
}
