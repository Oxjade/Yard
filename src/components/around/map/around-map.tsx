"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import "./around-map.css"
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import type { Feature, FeatureCollection, Point } from "geojson"
import type { GeoJSONSource, Map as MLMap, Marker as MLMarker, MapLibreEvent, StyleSpecification } from "maplibre-gl"
import { InfoIcon } from "@phosphor-icons/react"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { cities, haversineKm } from "@/lib/around/gazetteer"
import { kindLabel } from "@/lib/around/labels"
import { timedStatus } from "@/lib/around/hours"
import { CITY_ZOOM_MIN, type Bounds } from "@/lib/around/geo"
import { cn } from "@/lib/utils"
import { areaLabel, clusterPin, fillCluster, placePin, setPinSelected, youDot, type ClusterLeaf, type PinProps, type PinStatus } from "./pins"
import { loadCoast, loadWorld, type CityCoast, type LandData } from "./world-data"
import { areaFeatures, overlap, placeLabel, type Rect } from "./areas"

/**
 * The Around map engine (§6.4). MapLibre loads client-side only, with its worker served from
 * /vendor (Turbopack can't serve the worker beside the chunk). The base style is Yard's own:
 * the bundled Natural Earth land on a dark globe with a purple rim, no glyphs and no symbol
 * layers; city and neighbourhood names are HTML overlays from the gazetteer. OpenFreeMap streets
 * are a quiet enhancement that reports its state through `onEnhancement` and fails silently.
 *
 * Privacy (§5.6): this component never sees a precise position except `you`, which it draws as a
 * DOM dot; the camera only ever goes where the parent sends it (an area centroid after Locate).
 */

export type LatLng = { lat: number; lng: number }
export type Camera = { center: LatLng; zoom: number }
export type MapView = {
  zoom: number
  center: LatLng
  bounds: Bounds
  bearing: number
  /** The bounds of what isn't under page chrome (`viewInsets`), at zoom ≥ 4; else `bounds`. */
  inner: Bounds
}
export type Enhancement = "loading" | "ready" | "failed"
export type AroundMapHandle = {
  /** `offset` (px) shifts where the target ends up, e.g. above a bottom sheet. */
  flyTo: (camera: Camera, opts?: { offset?: [number, number] }) => void
  fitTo: (points: LatLng[], maxZoom?: number) => void
  zoomBy: (delta: number) => void
  resetNorth: () => void
  view: () => MapView | null
}

type Props = {
  mode: "browse" | "pick"
  initialCamera: Camera
  places?: PlaceSummaryDto[]
  selectedId?: string | null
  onSelectPlace?: (id: string) => void
  onView?: (view: MapView, user: boolean) => void
  onUserMoveStart?: () => void
  onIdle?: () => void
  onEnhancement?: (state: Enhancement) => void
  onFallback?: (reason: "webgl" | "error") => void
  you?: LatLng | null
  pick?: LatLng | null
  onPick?: (p: LatLng) => void
  /** Street-precision padding for fitTo, e.g. room for the desktop panel. */
  padding?: { top: number; right: number; bottom: number; left: number }
  className?: string
  /** Where the credits and scale bar sit (default bottom right), e.g. clear of a phone's home bar. */
  creditsClassName?: string
  /** Credits behind an info button (phones), so they never run into the area title. */
  compactCredits?: boolean
  /** Screen bands (px from each edge) under page chrome, which area names try to stay out of. */
  labelInsets?: { top?: number; right?: number; bottom?: number; left?: number }
  /** Screen bands that count as hidden for MapView.inner ("in view" means not under these). */
  viewInsets?: { top: number; right: number; bottom: number; left: number }
  label?: string
  ref?: React.Ref<AroundMapHandle>
}

const WORKER = "/vendor/maplibre-gl-worker.mjs?v=6.16.0"
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark"
const EMPTY: FeatureCollection<Point> = { type: "FeatureCollection", features: [] }
/* The bundled palette: near-black water, a clearly lighter land (Snap Map's globe reads land/water
   at a glance; ours keeps Yard's black but with the same contrast), hairline coasts and borders. */
const OCEAN = "#060609"
const LAND = "#1d1c24"
const RING_OPACITY = 0.18
/** City coastlines fade in over Natural Earth's between these zooms. */
const COAST_MIN_ZOOM = 9.4
const coastFade = (to: number) => ["interpolate", ["linear"], ["zoom"], COAST_MIN_ZOOM, 0, 10.2, to] as unknown as number
const RING_OPACITY_STREETS = 0.07
/** Neighbourhood names, dots and rings show from here (a phone frames a whole city at about 10.4). */
const HOOD_ZOOM = CITY_ZOOM_MIN
/** Past this the bundled map has nothing more to show, so it stops here until street tiles load. */
const BUNDLED_MAX_ZOOM = 14.5
const STREETS_MAX_ZOOM = 18
/** An area's ring or dot fades out when its name can't be shown clear of the page chrome. */
const unlessHidden = (v: number) => ["case", ["boolean", ["feature-state", "hidden"], false], 0, v]
const ringOpacity = (to: number) => ["interpolate", ["linear"], ["zoom"], HOOD_ZOOM - 0.4, 0, HOOD_ZOOM + 0.2, unlessHidden(to)] as unknown as number

/** Where browse mode was when the route was left, so coming back restores it (§6.4 step 9). */
let lastBrowseCamera: Camera | null = null
export const rememberedCamera = () => lastBrowseCamera

function prefetchCoasts(at: LatLng) {
  for (const city of cities) if (haversineKm(at.lat, at.lng, city.lat, city.lng) <= 160) void loadCoast(city.slug).catch(() => {})
}

const gazetteerNames = cities.flatMap((c) => [c.name, ...c.neighbourhoods.map((h) => h.name)])

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

function hasWebgl2() {
  try {
    const c = document.createElement("canvas")
    return !!c.getContext("webgl2")
  } catch {
    return false
  }
}

function baseStyle(world: LandData, mode: "browse" | "pick"): StyleSpecification {
  const areas = areaFeatures()
  return {
    version: 8,
    projection: { type: "globe" },
    sky: {
      "sky-color": "#080808",
      "horizon-color": "#1c0f36",
      "fog-color": "#080808",
      // No glow (house rule): the atmosphere is off and the rim is a purple hairline overlay instead.
      "atmosphere-blend": 0,
    },
    sources: {
      land: { type: "geojson", data: world.land },
      coast: { type: "geojson", data: world.coast },
      borders: { type: "geojson", data: world.borders },
      "coast-mask": { type: "geojson", data: EMPTY },
      "coast-land": { type: "geojson", data: EMPTY },
      "coast-water": { type: "geojson", data: EMPTY },
      "coast-shore": { type: "geojson", data: EMPTY },
      "area-rings": { type: "geojson", data: areas.rings, promoteId: "slug" },
      "area-dots": { type: "geojson", data: areas.dots, promoteId: "slug" },
      places: { type: "geojson", data: EMPTY, cluster: mode === "browse", clusterRadius: 56, clusterMaxZoom: 14 },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": OCEAN } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": LAND, "fill-antialias": false } },
      {
        id: "coast",
        type: "line",
        source: "coast",
        paint: {
          "line-color": "#f5f5f5",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.1, 9, 0.24],
          "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 10, 1, 14, 1.5],
        },
      },
      // A covered city's own coastline, lakes and rivers take over from Natural Earth's 50 m
      // outline as the camera reaches city zoom (owner review 2026-11-07: VI, Ikoyi and Lekki
      // were drawn in the sea). The mask is the city's box in water colour; land and water go on top.
      { id: "coast-mask", type: "fill", source: "coast-mask", minzoom: COAST_MIN_ZOOM, paint: { "fill-color": OCEAN, "fill-antialias": false, "fill-opacity": coastFade(1) } },
      { id: "coast-land", type: "fill", source: "coast-land", minzoom: COAST_MIN_ZOOM, paint: { "fill-color": LAND, "fill-antialias": false, "fill-opacity": coastFade(1) } },
      { id: "coast-water", type: "fill", source: "coast-water", minzoom: COAST_MIN_ZOOM, paint: { "fill-color": OCEAN, "fill-opacity": coastFade(1) } },
      {
        id: "coast-shore",
        type: "line",
        source: "coast-shore",
        minzoom: COAST_MIN_ZOOM,
        paint: { "line-color": "#f5f5f5", "line-opacity": coastFade(0.24), "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 1.5] },
      },
      { id: "borders", type: "line", source: "borders", paint: { "line-color": "rgba(245,245,245,0.07)", "line-width": 0.5 } },
      // Every gazetteer neighbourhood: a dashed ring ("roughly here", like an area pin) and a dot.
      {
        id: "area-rings",
        type: "line",
        source: "area-rings",
        minzoom: HOOD_ZOOM - 0.4,
        paint: { "line-color": "#f5f5f5", "line-opacity": ringOpacity(RING_OPACITY), "line-width": 1, "line-dasharray": [2, 3] },
      },
      {
        id: "area-dots-neighbourhood",
        type: "circle",
        source: "area-dots",
        minzoom: HOOD_ZOOM,
        filter: ["==", ["get", "level"], "neighbourhood"],
        paint: {
          "circle-radius": 3,
          "circle-color": OCEAN,
          "circle-opacity": unlessHidden(1),
          "circle-stroke-color": "#f5f5f5",
          "circle-stroke-opacity": unlessHidden(0.6),
          "circle-stroke-width": 1.25,
        },
      },
      {
        id: "area-dots-city",
        type: "circle",
        source: "area-dots",
        minzoom: 3.6,
        maxzoom: HOOD_ZOOM,
        filter: ["==", ["get", "level"], "city"],
        paint: { "circle-radius": 3, "circle-color": "#f5f5f5", "circle-opacity": unlessHidden(0.75), "circle-stroke-color": OCEAN, "circle-stroke-opacity": unlessHidden(1), "circle-stroke-width": 1.5 },
      },
      { id: "places-hit", type: "circle", source: "places", paint: { "circle-radius": 22, "circle-opacity": 0 } },
    ],
  } as StyleSpecification
}

function pinStatus(p: PlaceSummaryDto, now: number): PinStatus {
  if (p.kind === "store") return "store"
  if (p.kind === "showroom") return "showroom"
  return timedStatus(p.startsAt, p.endsAt, now) === "live" ? "live" : "upcoming"
}

function toFeatures(places: PlaceSummaryDto[]): FeatureCollection<Point> {
  const now = Date.now()
  return {
    type: "FeatureCollection",
    features: places.map(
      (p): Feature<Point> => ({
        type: "Feature",
        id: undefined,
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          id: p.id,
          markText: p.brand.mark.text,
          markStyle: p.brand.mark.style,
          brand: p.brand.name,
          kindLabel: kindLabel[p.kind],
          area: p.neighbourhood ?? p.city,
          sample: p.sample,
          status: pinStatus(p, now),
        },
      }),
    ),
  }
}

function boundsOf(map: MLMap): Bounds {
  const b = map.getBounds()
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
}

export function viewOf(map: MLMap, insets?: { top: number; right: number; bottom: number; left: number }): MapView {
  const c = map.getCenter()
  const bounds = boundsOf(map)
  let inner = bounds
  const zoom = map.getZoom()
  if (insets && zoom >= 4) {
    const { clientWidth: w, clientHeight: h } = map.getContainer()
    if (w - insets.left - insets.right > 40 && h - insets.top - insets.bottom > 40) {
      const nw = map.unproject([insets.left, insets.top])
      const se = map.unproject([w - insets.right, h - insets.bottom])
      inner = { west: nw.lng, north: nw.lat, east: se.lng, south: se.lat }
    }
  }
  return { zoom, center: { lat: c.lat, lng: c.lng }, bounds, bearing: map.getBearing(), inner }
}

export function AroundMap(props: Props) {
  const { ref, className, creditsClassName, compactCredits = false, label = "Map of places" } = props
  // Compact credits start open and fold into the info button at the first map gesture, as
  // MapLibre's compact attribution does; the button opens them again.
  const [creditsOpen, setCreditsOpen] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null)
  const markersRef = useRef(new Map<string, { marker: MLMarker; el: HTMLElement; sig: string; cluster: boolean; size?: { w: number; h: number } }>())
  /** Other DOM markers area names must stay clear of: the "you" dot and the pick pin, with their size. */
  const obstaclesRef = useRef(new Map<MLMarker, number>())
  /** Asks the map to re-place area names on its next frame. */
  const relayoutRef = useRef<() => void>(() => {})
  const rimRef = useRef<HTMLDivElement>(null)
  const creditsRef = useRef<HTMLDivElement>(null)
  const reconcileRef = useRef<() => void>(() => {})
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })
  const [ready, setReady] = useState(false)
  const [attribution, setAttribution] = useState<"base" | "streets">("base")
  const [scale, setScale] = useState<{ label: string; px: number } | null>(null)
  const [coastCredit, setCoastCredit] = useState(false)

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (camera, o) => {
        const map = mapRef.current
        if (!map) return
        // Heading for city zoom: fetch that city's coastline during the flight, not after it.
        if (camera.zoom >= COAST_MIN_ZOOM - 1) prefetchCoasts(camera.center)
        const opts = { center: [camera.center.lng, camera.center.lat] as [number, number], zoom: camera.zoom, bearing: 0, pitch: 0, ...(o?.offset ? { offset: o.offset } : {}) }
        if (reducedMotion()) map.easeTo({ ...opts, duration: 0 })
        else map.flyTo({ ...opts, speed: 1.6, curve: 1.4, essential: false })
      },
      fitTo: (points, maxZoom = 14) => {
        const map = mapRef.current
        const ml = mlRef.current
        if (!map || !ml || !points.length) return
        const b = new ml.LngLatBounds()
        for (const p of points) b.extend([p.lng, p.lat])
        map.fitBounds(b, { padding: 56, maxZoom, animate: !reducedMotion(), duration: 900 })
      },
      zoomBy: (delta) => {
        const map = mapRef.current
        if (!map) return
        map.easeTo({ zoom: map.getZoom() + delta, duration: reducedMotion() ? 0 : 300 })
      },
      resetNorth: () => mapRef.current?.resetNorthPitch({ duration: reducedMotion() ? 0 : 300 }),
      view: () => (mapRef.current ? viewOf(mapRef.current, propsRef.current.viewInsets) : null),
    }),
    [],
  )

  // Create the map once.
  useEffect(() => {
    let disposed = false
    const p0 = propsRef.current
    const mode = p0.mode
    const markers = markersRef.current
    const extra: MLMarker[] = []
    const leafCache = new Map<string, Promise<ClusterLeaf[]>>()
    let raf = 0
    let ofmErrors = 0
    let layoutDirty = true
    const fallback = (reason: "webgl" | "error") => {
      if (!disposed) propsRef.current.onFallback?.(reason)
    }

    void (async () => {
      if (!hasWebgl2()) return fallback("webgl")
      // Opening at city zoom: fetch that city's coastline alongside the globe data, so the coarse
      // outline barely shows before the city's own shapes replace it.
      if (p0.initialCamera.zoom >= COAST_MIN_ZOOM - 1) prefetchCoasts(p0.initialCamera.center)
      let ml: typeof import("maplibre-gl")
      let world: LandData
      try {
        ;[ml, world] = await Promise.all([import("maplibre-gl"), loadWorld("50m")])
      } catch {
        return fallback("error")
      }
      if (disposed || !containerRef.current) return
      ml.setWorkerUrl(WORKER)
      const phone = window.matchMedia("(max-width: 1023px)").matches
      let map: MLMap
      try {
        map = new ml.Map({
          container: containerRef.current,
          style: baseStyle(world, mode),
          center: [p0.initialCamera.center.lng, p0.initialCamera.center.lat],
          zoom: p0.initialCamera.zoom,
          minZoom: 0.8,
          maxZoom: BUNDLED_MAX_ZOOM,
          maxPitch: 60,
          dragRotate: !phone && mode === "browse",
          pitchWithRotate: !phone && mode === "browse",
          touchPitch: false,
          attributionControl: false,
          renderWorldCopies: false,
          fadeDuration: reducedMotion() ? 0 : 200,
        })
      } catch {
        return fallback("error")
      }
      if (phone) map.touchZoomRotate.disableRotation()
      // The camera's centre sits in the part of the map that isn't under the panel or the carousel.
      if (p0.padding) map.setPadding(p0.padding)
      mapRef.current = map
      mlRef.current = ml
      if (process.env.NODE_ENV !== "production") (window as unknown as { __yardAroundMap?: MLMap }).__yardAroundMap = map

      map.on("error", (ev) => {
        const e = ev as unknown as { error?: { message?: string }; sourceId?: string }
        if (e.sourceId === "ofm") {
          ofmErrors += 1
          if (ofmErrors === 3) dropStreets(map)
          return
        }
        if (/webgl/i.test(e.error?.message ?? "")) fallback("webgl")
      })

      /* ---- markers ---- */
      const reconcile = () => {
        if (disposed || mode !== "browse") return
        const src = map.getSource("places") as GeoJSONSource | undefined
        if (!src) return
        const feats = map.querySourceFeatures("places")
        const seen = new Set<string>()
        const selected = propsRef.current.selectedId ?? null
        for (const f of feats) {
          const props = f.properties as Record<string, unknown>
          const coords = (f.geometry as Point).coordinates as [number, number]
          const isCluster = !!props.cluster
          const key = isCluster ? `c:${props.cluster_id}:${Math.floor(map.getZoom())}` : `p:${props.id}`
          if (seen.has(key)) continue
          seen.add(key)
          const existing = markers.get(key)
          if (existing) {
            if (!isCluster) setPinSelected(existing.el, props.id === selected)
            continue
          }
          let el: HTMLElement
          if (isCluster) {
            const count = Number(props.point_count) || 0
            const clusterId = Number(props.cluster_id)
            el = clusterPin(count, () => {
              void src.getClusterExpansionZoom(clusterId).then((z) => {
                const opts = { center: coords, zoom: Math.min(z + 0.25, 16) }
                if (reducedMotion()) map.jumpTo(opts)
                else map.easeTo({ ...opts, duration: 600 })
              })
            })
            let leaves = leafCache.get(key)
            if (!leaves) {
              // Ten leaves, so the stack can find three different brands (one brand's places repeat).
              leaves = src.getClusterLeaves(clusterId, 10, 0).then((ls) => ls.map((l) => ({ markText: String(l.properties?.markText ?? ""), markStyle: String(l.properties?.markStyle ?? ""), brand: String(l.properties?.brand ?? "") })))
              leafCache.set(key, leaves)
            }
            void leaves.then((ls) => fillCluster(el, ls, count)).catch(() => {})
          } else {
            el = placePin(props as unknown as PinProps, (id) => propsRef.current.onSelectPlace?.(id))
            setPinSelected(el, props.id === selected)
          }
          const marker = new ml.Marker({ element: el, anchor: "center", opacityWhenCovered: 0, subpixelPositioning: true }).setLngLat(coords).addTo(map)
          markers.set(key, { marker, el, sig: key, cluster: isCluster })
          layoutDirty = true
        }
        for (const [key, m] of markers) {
          if (!seen.has(key)) {
            m.marker.remove()
            markers.delete(key)
            layoutDirty = true
          }
        }
      }
      reconcileRef.current = reconcile
      /* ---- the globe's rim: a purple hairline where Snap Map has a blue glow ---- */
      const syncRim = () => {
        const rim = rimRef.current
        if (!rim) return
        const z = map.getZoom()
        if (z > 4.5 || map.getPitch() > 1) {
          rim.style.display = "none"
          return
        }
        const c = map.getCenter()
        const cp = map.project(c)
        // The limb is where a point's screen distance from the centre peaks; sample along the east bearing.
        const lat0 = (c.lat * Math.PI) / 180
        const lng0 = (c.lng * Math.PI) / 180
        let r = 0
        for (let i = 1; i <= 90; i++) {
          const d = (i * Math.PI) / 90
          const lat = Math.asin(Math.sin(lat0) * Math.cos(d))
          const lng = lng0 + Math.atan2(Math.sin(d) * Math.cos(lat0), Math.cos(d) - Math.sin(lat0) * Math.sin(lat))
          const p = map.project([(lng * 180) / Math.PI, (lat * 180) / Math.PI])
          r = Math.max(r, Math.hypot(p.x - cp.x, p.y - cp.y))
        }
        const { clientWidth: w, clientHeight: h } = map.getContainer()
        if (!r || r > Math.hypot(w, h)) {
          rim.style.display = "none"
          return
        }
        rim.style.display = "block"
        rim.style.width = rim.style.height = `${2 * r}px`
        rim.style.transform = `translate(${cp.x - r}px, ${cp.y - r}px)`
      }
      /* ---- a hairline scale bar from city zoom down, so an empty stretch still reads as distance ---- */
      let lastScale = ""
      const syncScale = () => {
        const z = map.getZoom()
        if (z < 8) {
          if (lastScale) {
            lastScale = ""
            setScale(null)
          }
          return
        }
        const mpp = (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / (512 * 2 ** z)
        const max = mpp * 72
        const pow = 10 ** Math.floor(Math.log10(max))
        const nice = [5, 2, 1].map((f) => f * pow).find((d) => d <= max) ?? pow
        const px = Math.round(nice / mpp)
        const label = nice >= 1000 ? `${nice / 1000} km` : `${nice} m`
        const sig = `${label}:${px}`
        if (sig === lastScale) return
        lastScale = sig
        setScale({ label, px })
      }

      /* ---- city coastlines: fetched from our own /vendor route when the camera nears a city ---- */
      const coasts = new Map<string, CityCoast>()
      const requested = new Set<string>()
      let credit = false
      const syncCoastCredit = () => {
        let on = false
        if (map.getZoom() >= COAST_MIN_ZOOM && coasts.size) {
          const b = map.getBounds()
          on = [...coasts.values()].some((c) => !(c.bbox[2] < b.getWest() || c.bbox[0] > b.getEast() || c.bbox[3] < b.getSouth() || c.bbox[1] > b.getNorth()))
        }
        if (on !== credit) {
          credit = on
          setCoastCredit(on)
        }
      }
      const pushCoasts = () => {
        const list = [...coasts.values()]
        const set = (id: string, features: Feature[]) => (map.getSource(id) as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features })
        set(
          "coast-mask",
          list.map((c): Feature => {
            const [w, s, e, n] = c.bbox
            return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }
          }),
        )
        set("coast-land", list.flatMap((c) => c.land))
        set("coast-water", list.flatMap((c) => c.water))
        set("coast-shore", list.map((c) => c.shore))
        syncCoastCredit()
      }
      const ensureCoasts = () => {
        if (map.getZoom() < COAST_MIN_ZOOM - 1) return
        const c = map.getCenter()
        for (const city of cities) {
          if (requested.has(city.slug) || haversineKm(c.lat, c.lng, city.lat, city.lng) > 160) continue
          requested.add(city.slug)
          loadCoast(city.slug)
            .then((cc) => {
              if (disposed) return
              coasts.set(cc.slug, cc)
              pushCoasts()
            })
            .catch(() => requested.delete(city.slug))
        }
      }

      /* ---- area labels from the gazetteer, placed clear of pins (owner review 2026-11-07) ---- */
      type AreaLabel = { slug: string; marker: MLMarker; el: HTMLElement; lngLat: [number, number]; off: [number, number]; size?: { w: number; h: number } }
      const label = (slug: string, text: string, level: "city" | "neighbourhood", lng: number, lat: number): AreaLabel => {
        const el = areaLabel(text, level)
        el.style.zIndex = "1"
        const off: [number, number] = [0, 14]
        return { slug, marker: new ml.Marker({ element: el, anchor: "center", offset: off, opacityWhenCovered: 0 }).setLngLat([lng, lat]), el, lngLat: [lng, lat], off }
      }
      const cityLabels: AreaLabel[] = []
      const hoodLabels: AreaLabel[] = []
      for (const c of cities) {
        cityLabels.push(label(c.slug, c.name, "city", c.lng, c.lat))
        for (const h of c.neighbourhoods) hoodLabels.push(label(`${c.slug}/${h.slug}`, h.name, "neighbourhood", h.lng, h.lat))
      }
      /** Which areas' rings and dots are faded because their name sits under the chrome. */
      const hiddenAreas = new Set<string>()
      const setAreaHidden = (slug: string, hidden: boolean) => {
        if (hidden === hiddenAreas.has(slug)) return
        if (hidden) hiddenAreas.add(slug)
        else hiddenAreas.delete(slug)
        for (const source of ["area-rings", "area-dots"]) if (map.getSource(source)) map.setFeatureState({ source, id: slug }, { hidden })
      }
      let shown: "none" | "city" | "hood" = "none"
      const syncLabels = () => {
        const z = map.getZoom()
        const want = z >= HOOD_ZOOM ? "hood" : z >= 4 ? "city" : "none"
        if (want === shown) return
        shown = want
        layoutDirty = true
        for (const l of cityLabels) {
          if (want === "city") l.marker.addTo(map)
          else l.marker.remove()
        }
        for (const l of hoodLabels) {
          if (want === "hood") l.marker.addTo(map)
          else l.marker.remove()
        }
        // Names that left the map no longer hide their markers.
        for (const l of want === "hood" ? cityLabels : want === "city" ? hoodLabels : [...cityLabels, ...hoodLabels]) setAreaHidden(l.slug, false)
      }
      extra.push(...cityLabels.map((l) => l.marker), ...hoodLabels.map((l) => l.marker))

      // Each name takes the first spot around its centroid that no pin, cluster, "you" dot or
      // earlier name covers; names are placed in gazetteer order, so the result is stable.
      const placeLabels = () => {
        const active = shown === "city" ? cityLabels : shown === "hood" ? hoodLabels : []
        if (!active.length) return
        const { clientWidth: W, clientHeight: H } = map.getContainer()
        const obstacles: Rect[] = []
        const box = (at: { x: number; y: number }, w: number, h: number, pad: number): Rect => ({ x: at.x - w / 2 - pad, y: at.y - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad })
        for (const m of markers.values()) {
          if (!m.size) m.size = { w: m.el.offsetWidth || 44, h: m.el.offsetHeight || 44 }
          const at = map.project(m.marker.getLngLat())
          // A cluster's count chip hangs off its top right; a selected pin is scaled up 10%.
          obstacles.push(m.cluster ? { x: at.x - m.size.w / 2 - 3, y: at.y - m.size.h / 2 - 11, w: m.size.w + 18, h: m.size.h + 14 } : box(at, m.size.w, m.size.h, 5))
        }
        for (const [m, size] of obstaclesRef.current) obstacles.push(box(map.project(m.getLngLat()), size, size, 4))
        // Page chrome (header, title, panel) and the credits: names avoid them, but pins come first.
        // Solid chrome (header, title, desktop panel) hides what's under it; the phone's bottom band
        // (pill and carousel) has gaps, so it's only a preference.
        const chrome: Rect[] = []
        const soft: Rect[] = []
        const ins = propsRef.current.labelInsets
        if (ins?.top) chrome.push({ x: 0, y: 0, w: W, h: ins.top })
        if (ins?.left) chrome.push({ x: 0, y: 0, w: ins.left, h: H })
        if (ins?.bottom) soft.push({ x: 0, y: H - ins.bottom, w: W, h: ins.bottom })
        if (ins?.right) soft.push({ x: W - ins.right, y: 0, w: ins.right, h: H })
        const host = map.getContainer().getBoundingClientRect()
        const rectOf = (el: Element, pad: number): Rect | null => {
          const r = el.getBoundingClientRect()
          return r.width && r.height ? { x: r.left - host.left - pad, y: r.top - host.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad } : null
        }
        const cr = creditsRef.current ? rectOf(creditsRef.current, 4) : null
        if (cr) chrome.push(cr)
        // Page controls drawn over the map (the phone's control column, the title) mark
        // themselves with data-map-chrome: a name never hides under them.
        const root = map.getContainer().closest("[data-around-root]")
        if (root) for (const el of root.querySelectorAll("[data-map-chrome]")) {
          const r = rectOf(el, 6)
          if (r) chrome.push(r)
        }
        const placed: Rect[] = [...chrome, ...soft]
        for (const l of active) {
          const at = map.project(l.lngLat)
          if (at.x < -200 || at.x > W + 200 || at.y < -100 || at.y > H + 100) continue
          if (!l.size) {
            const w = l.el.offsetWidth
            if (!w) continue
            l.size = { w, h: l.el.offsetHeight }
          }
          const { offset, rect } = placeLabel(at, l.size, obstacles, placed, { w: W, h: H })
          placed.push(rect)
          if (offset[0] !== l.off[0] || offset[1] !== l.off[1]) {
            l.off = offset
            l.marker.setOffset(offset)
          }
          // A name whose every spot is mostly under the header, the panel or off screen is left
          // out rather than drawn half-hidden behind them.
          const area = rect.w * rect.h
          let hidden = area - overlap(rect, { x: 0, y: 0, w: W, h: H })
          for (const c of chrome) hidden += overlap(rect, c)
          const under = hidden > area * 0.4
          if (under !== l.el.hasAttribute("data-under-chrome")) l.el.toggleAttribute("data-under-chrome", under)
          // Its ring and dot go with it, and so does a centroid that sits under the chrome itself
          // (the Ikeja dot inside the phone wordmark).
          const centreUnder = chrome.some((c) => at.x >= c.x && at.x <= c.x + c.w && at.y >= c.y && at.y <= c.y + c.h)
          setAreaHidden(l.slug, under || centreUnder)
        }
      }
      relayoutRef.current = () => {
        layoutDirty = true
        schedule()
      }

      const schedule = () => {
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          reconcile()
          syncRim()
          syncScale()
          if (layoutDirty) {
            layoutDirty = false
            placeLabels()
          }
        })
      }

      map.on("load", () => {
        if (disposed) return
        setReady(true)
        syncLabels()
        const src = map.getSource("places") as GeoJSONSource | undefined
        if (mode === "browse") src?.setData(toFeatures(propsRef.current.places ?? []))
        propsRef.current.onView?.(viewOf(map, propsRef.current.viewInsets), false)
        ensureCoasts()
        void enhance(map)
      })
      map.on("zoom", () => {
        syncLabels()
        layoutDirty = true
      })
      map.on("resize", () => {
        layoutDirty = true
      })
      map.on("render", schedule)
      map.on("sourcedata", (e: { sourceId?: string }) => {
        if (e.sourceId === "places") schedule()
      })
      map.on("movestart", (e: MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
        if (!e.originalEvent) return
        setCreditsOpen(false)
        propsRef.current.onUserMoveStart?.()
      })
      map.on("moveend", (e: MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
        if (mode === "browse") {
          const c = map.getCenter()
          lastBrowseCamera = { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() }
        }
        ensureCoasts()
        syncCoastCredit()
        propsRef.current.onView?.(viewOf(map, propsRef.current.viewInsets), !!e.originalEvent)
        propsRef.current.onIdle?.()
      })
    })()

    /* ---- OpenFreeMap streets: progressive enhancement that fails quietly ---- */
    const OFM_LAYERS = ["ofm-water", "ofm-park", "ofm-landuse", "ofm-roads-minor", "ofm-roads-major", "ofm-roads-motorway", "ofm-buildings", "ofm-places"]
    function dropStreets(map: MLMap) {
      for (const id of OFM_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource("ofm")) map.removeSource("ofm")
      if (map.getLayer("area-rings")) map.setPaintProperty("area-rings", "line-opacity", ringOpacity(RING_OPACITY))
      map.setMaxZoom(BUNDLED_MAX_ZOOM)
      setAttribution("base")
      propsRef.current.onEnhancement?.("failed")
    }
    async function enhance(map: MLMap) {
      propsRef.current.onEnhancement?.("loading")
      const ctrl = new AbortController()
      const timer = window.setTimeout(() => ctrl.abort(), 4000)
      try {
        const res = await fetch(STYLE_URL, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" })
        if (!res.ok) throw new Error(String(res.status))
        const style = (await res.json()) as { sources?: Record<string, { type: string; url?: string; tiles?: string[]; maxzoom?: number; minzoom?: number }>; glyphs?: string }
        window.clearTimeout(timer)
        if (disposed || !mapRef.current) return
        const vector = Object.values(style.sources ?? {}).find((s) => s.type === "vector")
        if (!vector || (!vector.url && !vector.tiles)) throw new Error("no vector source")
        map.addSource("ofm", { type: "vector", ...(vector.url ? { url: vector.url } : { tiles: vector.tiles }), ...(vector.maxzoom ? { maxzoom: vector.maxzoom } : {}) })
        // Streets go under Yard's own area rings, dots and pins.
        const before = "area-rings"
        const fill = (id: string, layer: string, color: string, filter?: unknown, minzoom = 5) =>
          map.addLayer({ id, type: "fill", source: "ofm", "source-layer": layer, minzoom, ...(filter ? { filter } : {}), paint: { "fill-color": color } } as never, before)
        const line = (id: string, classes: string[], color: string, width: number) =>
          map.addLayer({ id, type: "line", source: "ofm", "source-layer": "transportation", minzoom: 5, filter: ["in", ["get", "class"], ["literal", classes]], paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 8, width * 0.4, 16, width * 3] } } as never, before)
        fill("ofm-water", "water", OCEAN)
        fill("ofm-park", "park", "#121614")
        fill("ofm-landuse", "landuse", "#161519", ["==", ["get", "class"], "residential"])
        line("ofm-roads-minor", ["minor", "service", "tertiary"], "#232228", 0.8)
        line("ofm-roads-major", ["primary", "secondary", "trunk"], "#2c2a33", 1.2)
        line("ofm-roads-motorway", ["motorway"], "#35323d", 1.6)
        fill("ofm-buildings", "building", "#1d1c22", undefined, 14)
        // Place names only when the style's glyphs answer within 2 s.
        if (style.glyphs) {
          const g = new AbortController()
          const gt = window.setTimeout(() => g.abort(), 2000)
          const ok = await fetch(style.glyphs.replace("{fontstack}", encodeURIComponent("Noto Sans Regular")).replace("{range}", "0-255"), { signal: g.signal, credentials: "omit", referrerPolicy: "no-referrer" })
            .then((r) => r.ok)
            .catch(() => false)
          window.clearTimeout(gt)
          if (ok && !disposed && mapRef.current) {
            map.setGlyphs(style.glyphs)
            map.addLayer(
              {
                id: "ofm-places",
                type: "symbol",
                source: "ofm",
                "source-layer": "place",
                minzoom: 5,
                // Yard's own gazetteer names stay the labels for its areas; the street map's own
                // place names are quieter and never repeat one of them.
                filter: ["!", ["in", ["coalesce", ["get", "name:en"], ["get", "name"]], ["literal", gazetteerNames]]],
                layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 10 },
                paint: { "text-color": "#6b6b70", "text-halo-color": "#080808", "text-halo-width": 1 },
              } as never,
              before,
            )
          }
        }
        // With streets under them, the area rings step back.
        if (map.getLayer("area-rings")) map.setPaintProperty("area-rings", "line-opacity", ringOpacity(RING_OPACITY_STREETS))
        // Streets have detail to the door, so the map may come closer now.
        map.setMaxZoom(STREETS_MAX_ZOOM)
        setAttribution("streets")
        propsRef.current.onEnhancement?.("ready")
      } catch {
        window.clearTimeout(timer)
        if (disposed) return
        if (process.env.NODE_ENV !== "production") logOnce("[yard] Around: street tiles from OpenFreeMap didn't load; showing the bundled map.")
        propsRef.current.onEnhancement?.("failed")
      }
    }

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      for (const m of markers.values()) m.marker.remove()
      markers.clear()
      for (const m of extra) m.remove()
      mapRef.current?.remove()
      mapRef.current = null
      reconcileRef.current = () => {}
      relayoutRef.current = () => {}
      if (process.env.NODE_ENV !== "production") delete (window as unknown as { __yardAroundMap?: MLMap }).__yardAroundMap
    }
  }, [])

  // Places → the clustered source.
  const places = props.places
  const lastSig = useRef("")
  useEffect(() => {
    if (!ready || props.mode !== "browse") return
    const fc = toFeatures(places ?? [])
    // Same places, same states: don't re-tile the source (it would redraw every pin).
    const sig = fc.features.map((f) => `${f.properties?.id}:${f.properties?.status}`).join(",")
    if (sig === lastSig.current) return
    lastSig.current = sig
    const src = mapRef.current?.getSource("places") as GeoJSONSource | undefined
    src?.setData(fc)
  }, [ready, places, props.mode])

  // The credits opening or closing changes what names must avoid.
  useEffect(() => {
    if (ready) relayoutRef.current()
  }, [ready, creditsOpen, coastCredit, attribution])

  // Selection → ring.
  const selectedId = props.selectedId
  useEffect(() => {
    if (!ready) return
    for (const [key, m] of markersRef.current) if (key.startsWith("p:")) setPinSelected(m.el, key === `p:${selectedId}`)
    relayoutRef.current()
  }, [ready, selectedId])

  // The "you" dot: a DOM overlay at the precise point, never in the data source.
  const you = props.you
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml || !you) return
    const m = new ml.Marker({ element: youDot(), anchor: "center", opacityWhenCovered: 0 }).setLngLat([you.lng, you.lat]).addTo(map)
    const obstacles = obstaclesRef.current
    obstacles.set(m, 22)
    relayoutRef.current()
    return () => {
      m.remove()
      obstacles.delete(m)
      relayoutRef.current()
    }
  }, [ready, you])

  // Pick mode: one draggable pin, kept in step with typed coordinates.
  const pickMarker = useRef<MLMarker | null>(null)
  const pick = props.pick
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml || props.mode !== "pick" || !pick) return
    if (!pickMarker.current) {
      const el = document.createElement("div")
      el.setAttribute("role", "img")
      el.setAttribute("aria-label", "The place's pin. Drag it, or type the coordinates below.")
      el.className = "flex size-9 cursor-grab items-center justify-center rounded-full border-2 border-obsidian bg-purple active:cursor-grabbing"
      el.innerHTML = '<span class="size-2.5 rounded-full bg-ink"></span>'
      const m = new ml.Marker({ element: el, anchor: "center", draggable: true }).setLngLat([pick.lng, pick.lat]).addTo(map)
      m.on("dragend", () => {
        const at = m.getLngLat()
        propsRef.current.onPick?.({ lat: Math.round(at.lat * 1e6) / 1e6, lng: Math.round(at.lng * 1e6) / 1e6 })
        relayoutRef.current()
      })
      el.style.zIndex = "2"
      obstaclesRef.current.set(m, 36)
      relayoutRef.current()
      pickMarker.current = m
    } else {
      const cur = pickMarker.current.getLngLat()
      if (Math.abs(cur.lat - pick.lat) > 1e-7 || Math.abs(cur.lng - pick.lng) > 1e-7) {
        pickMarker.current.setLngLat([pick.lng, pick.lat])
        if (!map.getBounds().contains([pick.lng, pick.lat])) map.jumpTo({ center: [pick.lng, pick.lat] })
        relayoutRef.current()
      }
    }
  }, [ready, pick, props.mode])
  useEffect(() => {
    const obstacles = obstaclesRef.current
    return () => {
      if (pickMarker.current) obstacles.delete(pickMarker.current)
      pickMarker.current?.remove()
      pickMarker.current = null
    }
  }, [])

  const credits = `Natural Earth${attribution === "streets" ? ", © OpenStreetMap contributors, OpenFreeMap" : coastCredit ? ", © OpenStreetMap contributors" : ""}`
  return (
    <div className={cn("yard-around-map relative overflow-hidden", className)}>
      {/* MapLibre makes its container position: relative, so it fills an absolute wrapper. */}
      <div className="absolute inset-0">
        <div ref={containerRef} role="region" aria-label={label} className="h-full w-full" />
      </div>
      <div ref={rimRef} aria-hidden className="pointer-events-none absolute top-0 left-0 hidden rounded-full border border-purple/70" />
      <div ref={creditsRef} className={cn("pointer-events-none absolute right-2 bottom-1 z-[1] flex items-end gap-3 text-[10px] text-ink-3/80 [text-shadow:0_1px_2px_#080808]", creditsClassName)}>
        {scale ? (
          <span className="flex flex-col items-start gap-0.5" aria-label={`Scale: this bar is ${scale.label}`} role="img">
            <span aria-hidden className="tabular leading-none">{scale.label}</span>
            <span aria-hidden className="block h-1 border-x border-b border-ink-2/70" style={{ width: scale.px }} />
          </span>
        ) : null}
        {compactCredits ? (
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={creditsOpen ? "Hide map credits" : "Map credits"}
              aria-expanded={creditsOpen}
              onClick={() => setCreditsOpen((o) => !o)}
              className="pointer-events-auto -m-2.5 inline-flex size-10 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet"
            >
              <InfoIcon className="size-4 text-ink-2" aria-hidden />
            </button>
            {creditsOpen ? <p className="rounded-full bg-obsidian/80 px-2 py-1 text-ink-2">{credits}</p> : null}
          </span>
        ) : (
          <p>{credits}</p>
        )}
      </div>
    </div>
  )
}

let logged = false
function logOnce(msg: string) {
  if (logged) return
  logged = true
  console.info(msg)
}
