import { cities, haversineKm, nearestArea, type AreaHit } from "./gazetteer"

/**
 * Coarse geography for YARD Around (§5.6). Pure and isomorphic: the browser computes distances
 * and tile keys locally; the server only ever sees 1° tile keys (about 110 km) in blocks of at
 * least 3×3, or `scope=world`.
 */

export { haversineKm }

/** The 1°×1° cell of a point: `floor(lat)_floor(lng)`, the same key the database generates. */
export const tileOf = (lat: number, lng: number) => `${Math.floor(lat)}_${Math.floor(wrapLng(lng))}`

export const MAX_TILES = 12

export function wrapLng(lng: number) {
  const w = ((((lng + 180) % 360) + 360) % 360) - 180
  return w === -180 && lng > 0 ? 180 : w
}

/** Tile keys as [lat, lng] numbers. */
export function parseTile(key: string): [number, number] | null {
  const m = /^(-?\d{1,3})_(-?\d{1,3})$/.exec(key)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (lat < -90 || lat > 89 || lng < -180 || lng > 179) return null
  return [lat, lng]
}

export type Bounds = { west: number; south: number; east: number; north: number }

/** Every 1° cell a box touches (west may exceed east across the antimeridian). */
export function tilesIn(b: Bounds, cap = 400): string[] | null {
  const south = Math.max(-90, Math.floor(b.south))
  const north = Math.min(89, Math.floor(b.north))
  let west = Math.floor(b.west)
  let east = Math.floor(b.east)
  if (east < west) east += 360
  if (east - west >= 360) {
    west = -180
    east = 179
  }
  const out: string[] = []
  for (let la = south; la <= north; la++) {
    for (let lo = west; lo <= east; lo++) {
      out.push(`${la}_${Math.floor(wrapLng(lo + 0.5))}`)
      if (out.length > cap) return null
    }
  }
  return [...new Set(out)]
}

/**
 * What the map asks the server for (§5.6, §6.4 step 7): the visible 1° tiles plus at least the
 * 3×3 block around the viewport centre, sorted, at most 12; anything wider (or a zoom under 4)
 * is `world`. Never the single tile someone is in.
 */
export function placesRequestFor(view: { zoom: number; center: { lat: number; lng: number }; bounds: Bounds }): { scope: "world" } | { tiles: string[] } {
  if (view.zoom < 4) return { scope: "world" }
  const visible = tilesIn(view.bounds, MAX_TILES * 4)
  if (!visible) return { scope: "world" }
  const cLat = Math.floor(view.center.lat)
  const cLng = Math.floor(wrapLng(view.center.lng))
  const block: string[] = []
  for (let dl = -1; dl <= 1; dl++) for (let dg = -1; dg <= 1; dg++) block.push(`${Math.max(-90, Math.min(89, cLat + dl))}_${Math.floor(wrapLng(cLng + dg + 0.5))}`)
  const all = [...new Set([...block, ...visible])]
  if (all.length > MAX_TILES) return { scope: "world" }
  return { tiles: all.sort() }
}

/** "1.2 km", "850 m", "24 km". */
export function formatDistance(km: number) {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km).toLocaleString("en-GB")} km`
}

/** Where a camera at `zoom` over a point is, for the Snap-style title and the area pill (§6.4 step 7). */
export type CameraArea = { level: "earth" } | { level: "country"; country: string; name: string } | { level: "city" | "neighbourhood"; area: AreaHit }

const countryNames: Record<string, string> = {
  NG: "Nigeria",
  GH: "Ghana",
  KE: "Kenya",
  ZA: "South Africa",
  GB: "United Kingdom",
  FR: "France",
  DE: "Germany",
  US: "United States",
  MX: "Mexico",
  JP: "Japan",
  KR: "South Korea",
}
export const countryName = (code: string) => countryNames[code] ?? code

export function cameraArea(lat: number, lng: number, zoom: number): CameraArea {
  if (zoom >= 12) {
    const hood = nearestArea(lat, lng, 5, "neighbourhood")
    if (hood) return { level: "neighbourhood", area: hood }
  }
  if (zoom >= 8) {
    const city = nearestArea(lat, lng, 60, "city")
    if (city) return { level: "city", area: city }
  }
  if (zoom >= 4) {
    const city = nearestArea(lat, lng, 900, "city")
    if (city) return { level: "country", country: city.city.country, name: countryName(city.city.country) }
  }
  return { level: "earth" }
}

/** The part of the map a camera frames, in px: the container minus the padding kept for page chrome. */
export type Frame = { w: number; h: number }

export const CITY_ZOOM_MAX = 11.5
/** A city's neighbourhoods are framed no further out than this. */
export const CITY_ZOOM_MIN = 10.4
/**
 * Neighbourhood names, rings and dots show from this zoom, so a framed city always has them: its
 * neighbourhoods (10.4 and closer), or on a small phone its places (down to this zoom).
 */
export const HOOD_ZOOM = 10.2
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const fromMercY = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90
/** Room around the outermost neighbourhoods (about a ring's radius), in degrees. */
const FRAME_PAD = 0.012

type LatLng = { lat: number; lng: number }

/** The camera that frames `pts` (plus a ring's radius) in `frame`, no further out than `minZoom`, and whether they fit. */
function fitPoints(pts: readonly LatLng[], frame: Frame | undefined, minZoom: number) {
  const west = Math.min(...pts.map((p) => p.lng)) - FRAME_PAD
  const east = Math.max(...pts.map((p) => p.lng)) + FRAME_PAD
  const south = Math.min(...pts.map((p) => p.lat)) - FRAME_PAD
  const north = Math.max(...pts.map((p) => p.lat)) + FRAME_PAD
  const center = { lat: Math.round(fromMercY((mercY(south) + mercY(north)) / 2) * 1e5) / 1e5, lng: Math.round(((west + east) / 2) * 1e5) / 1e5 }
  if (!frame || frame.w <= 0 || frame.h <= 0) return { camera: { center, zoom: CITY_ZOOM_MAX }, fits: true }
  // MapLibre's world is 512·2^z px wide; mercator y spans 2π over that height.
  const zx = Math.log2((frame.w * 360) / (512 * (east - west)))
  const zy = Math.log2((frame.h * 2 * Math.PI) / (512 * (mercY(north) - mercY(south))))
  const z = Math.floor(Math.min(zx, zy) * 20) / 20
  return { camera: { center, zoom: Math.min(CITY_ZOOM_MAX, Math.max(minZoom, z)) }, fits: z >= minZoom }
}

/**
 * The camera that a manual area choice and a location fix both use (§5.6): never the fix itself.
 * A neighbourhood: its centroid at zoom 13.5. A city: the box around its centroid and gazetteer
 * neighbourhoods (public data), as close as 11.5 and no further out than 10.4, fitted to `frame`.
 * On a 390 px phone that shows Lagos from Ikeja to Lekki instead of the 10 km around the centroid.
 *
 * Where even 10.4 can't fit that box (a 390×664 or 320×568 phone), the box of the city's places
 * (`places`, public data the page already holds) is framed instead, as far out as 10.2 where the
 * neighbourhood names still show, so the brands near the shopper
 * sit in the free part of the map and not under the pill, controls and carousel (review
 * 2026-11-08). It depends only on the area, the screen and the places, never on a fix, so a fix
 * and a manual choice still land identically.
 */
export function areaCamera(area: AreaHit, frame?: Frame, places: readonly LatLng[] = []) {
  if (area.kind === "neighbourhood") return { center: { lat: area.lat, lng: area.lng }, zoom: 13.5 }
  const city = fitPoints([area.city, ...area.city.neighbourhoods], frame, CITY_ZOOM_MIN)
  if (city.fits) return city.camera
  const near = places.filter((p) => haversineKm(area.city.lat, area.city.lng, p.lat, p.lng) <= areaRadiusKm(area))
  return near.length ? fitPoints(near, frame, HOOD_ZOOM).camera : city.camera
}

/**
 * After a location fix: the nearest gazetteer neighbourhood within 5 km, else the nearest city
 * within 60 km, else the fix itself at zoom ≤ 10 (tiles of about 40 km). The returned area is
 * shown but never saved or put in a URL. `places` is what a manual choice would frame too.
 */
export function cameraForFix(lat: number, lng: number, frame?: Frame, places: readonly LatLng[] = []): { center: { lat: number; lng: number }; zoom: number; area: AreaHit | null } {
  const hood = nearestArea(lat, lng, 5, "neighbourhood")
  if (hood) return { ...areaCamera(hood, frame, places), area: hood }
  const city = nearestArea(lat, lng, 60, "city")
  if (city) return { ...areaCamera(city, frame, places), area: city }
  return { center: { lat, lng }, zoom: 10, area: null }
}

/** The radius an area pill counts brands within. */
export const areaRadiusKm = (area: AreaHit) => (area.kind === "neighbourhood" ? 5 : 60)

/** The globe view the page opens on without a saved area: Africa and Europe, like the Snap Map screenshot. */
export const GLOBE_CAMERA = { center: { lat: 12, lng: 15 }, zoom: 1.6 }
/** Wide screens get a slightly closer globe, so it isn't a small disc beside the panel. */
export const globeCamera = (wide: boolean) => (wide ? { ...GLOBE_CAMERA, zoom: 2.1 } : GLOBE_CAMERA)

export const coveredCities = cities.map((c) => ({ slug: c.slug, name: c.name }))
