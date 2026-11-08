import type { Feature, FeatureCollection, LineString, Point } from "geojson"
import { cities, haversineKm } from "@/lib/around/gazetteer"

/**
 * Area markers for the bundled map (§6.4, owner review 2026-11-07). Street tiles can't load from
 * this machine, so at city and neighbourhood zoom the map would otherwise be coastline and a few
 * names. Every gazetteer area gets a quiet marker instead: a dot at its centroid and, for a
 * neighbourhood, a dashed ring that says "roughly here" — which is all an area pin claims.
 *
 * A ring's radius is 45% of the distance to the nearest sibling neighbourhood (0.5–1.6 km), so
 * neighbouring rings rarely cross. Nothing here is anyone's position: these are public centroids.
 */

export type AreaFeatureProps = { level: "city" | "neighbourhood"; name: string; slug: string }

const RING_STEPS = 72

function ring(lat: number, lng: number, km: number): number[][] {
  const dLat = km / 110.574
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180))
  const out: number[][] = []
  for (let i = 0; i <= RING_STEPS; i++) {
    const a = (i / RING_STEPS) * 2 * Math.PI
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return out
}

export function neighbourhoodRadiusKm(lat: number, lng: number, siblings: { lat: number; lng: number }[]) {
  let nearest = Infinity
  for (const s of siblings) {
    if (s.lat === lat && s.lng === lng) continue
    nearest = Math.min(nearest, haversineKm(lat, lng, s.lat, s.lng))
  }
  if (!Number.isFinite(nearest)) return 1.2
  return Math.max(0.5, Math.min(1.6, nearest * 0.45))
}

let cached: { rings: FeatureCollection<LineString, AreaFeatureProps>; dots: FeatureCollection<Point, AreaFeatureProps> } | null = null

export function areaFeatures() {
  if (cached) return cached
  const rings: Feature<LineString, AreaFeatureProps>[] = []
  const dots: Feature<Point, AreaFeatureProps>[] = []
  for (const c of cities) {
    dots.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { level: "city", name: c.name, slug: c.slug } })
    for (const h of c.neighbourhoods) {
      const km = neighbourhoodRadiusKm(h.lat, h.lng, c.neighbourhoods)
      const props: AreaFeatureProps = { level: "neighbourhood", name: h.name, slug: `${c.slug}/${h.slug}` }
      rings.push({ type: "Feature", geometry: { type: "LineString", coordinates: ring(h.lat, h.lng, km) }, properties: props })
      dots.push({ type: "Feature", geometry: { type: "Point", coordinates: [h.lng, h.lat] }, properties: props })
    }
  }
  cached = { rings: { type: "FeatureCollection", features: rings }, dots: { type: "FeatureCollection", features: dots } }
  return cached
}

/* ---- label placement: keep area names clear of pins, clusters and the "you" dot ---- */

export type Rect = { x: number; y: number; w: number; h: number }

export function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Where a label of size w×h can sit around its anchor, in order of preference: just under the
 * centroid's dot, then above, right and left of a pin there, then one step further out.
 * Offsets are of the label's centre from the anchor, in px.
 */
export function labelCandidates(w: number, h: number): [number, number][] {
  const below = h / 2 + 7
  const clear = h / 2 + 27
  const side = w / 2 + 30
  return [
    [0, below],
    [0, -clear],
    [0, clear],
    [side, 0],
    [-side, 0],
    [0, -(clear + 26)],
    [0, clear + 26],
    [side + 26, 0],
    [-(side + 26), 0],
  ]
}

/**
 * Picks the first candidate that touches no obstacle, no label already placed and stays on screen;
 * failing that, the one that covers least (a name half under a pin still beats a hidden one).
 */
export function placeLabel(anchor: { x: number; y: number }, size: { w: number; h: number }, obstacles: Rect[], placed: Rect[], view?: { w: number; h: number }): { offset: [number, number]; rect: Rect } {
  let best: { offset: [number, number]; rect: Rect } | null = null
  let bestCost = Infinity
  for (const offset of labelCandidates(size.w, size.h)) {
    const rect = { x: anchor.x + offset[0] - size.w / 2, y: anchor.y + offset[1] - size.h / 2, w: size.w, h: size.h }
    let cost = 0
    for (const o of obstacles) cost += overlap(rect, o) * 3
    for (const p of placed) cost += overlap(rect, p)
    // A name pushed off the screen is as lost as one under a pin.
    if (view) cost += (rect.w * rect.h - overlap(rect, { x: 0, y: 0, w: view.w, h: view.h })) * 3
    if (cost === 0) return { offset, rect }
    if (cost < bestCost) {
      bestCost = cost
      best = { offset, rect }
    }
  }
  return best!
}

/* ---- map credits: kept readable and clear of pins (owner review 2026-11-07, 22:45) ---- */

/** A place the credits block may sit, in px from the map's edges (one of top/bottom, one of left/right). */
export type CreditSpot = { top?: number; bottom?: number; left?: number; right?: number }

export function spotRect(spot: CreditSpot, size: { w: number; h: number }, view: { w: number; h: number }): Rect {
  const x = spot.left ?? view.w - (spot.right ?? 0) - size.w
  const y = spot.top ?? view.h - (spot.bottom ?? 0) - size.h
  return { x, y, w: size.w, h: size.h }
}

/**
 * The first spot whose block (plus a 4 px margin) no pin, cluster or "you" dot touches; failing
 * that, the one they cover least. Spots are in order of preference, so the credits only move
 * when a pin would sit on them.
 */
export function pickCreditSpot(spots: CreditSpot[], size: { w: number; h: number }, view: { w: number; h: number }, pins: Rect[]): number {
  let best = 0
  let bestCost = Infinity
  for (let i = 0; i < spots.length; i++) {
    const r = spotRect(spots[i], size, view)
    const padded = { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }
    let cost = 0
    for (const p of pins) cost += overlap(padded, p)
    if (cost === 0) return i
    if (cost < bestCost) {
      bestCost = cost
      best = i
    }
  }
  return best
}
