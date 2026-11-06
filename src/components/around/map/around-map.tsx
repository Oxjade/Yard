"use client"

import "maplibre-gl/dist/maplibre-gl.css"
import "./around-map.css"
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import type { Feature, FeatureCollection, Point } from "geojson"
import type { GeoJSONSource, Map as MLMap, Marker as MLMarker, MapLibreEvent, StyleSpecification } from "maplibre-gl"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { cities } from "@/lib/around/gazetteer"
import { kindLabel } from "@/lib/around/labels"
import { timedStatus } from "@/lib/around/hours"
import type { Bounds } from "@/lib/around/geo"
import { cn } from "@/lib/utils"
import { areaLabel, clusterPin, fillCluster, placePin, setPinSelected, youDot, type ClusterLeaf, type PinProps, type PinStatus } from "./pins"
import { loadWorld, type LandData } from "./world-data"

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
export type MapView = { zoom: number; center: LatLng; bounds: Bounds; bearing: number }
export type Enhancement = "loading" | "ready" | "failed"
export type AroundMapHandle = {
  flyTo: (camera: Camera) => void
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
  label?: string
  ref?: React.Ref<AroundMapHandle>
}

const WORKER = "/vendor/maplibre-gl-worker.mjs?v=6.16.0"
const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/dark"
const EMPTY: FeatureCollection<Point> = { type: "FeatureCollection", features: [] }

/** Where browse mode was when the route was left, so coming back restores it (§6.4 step 9). */
let lastBrowseCamera: Camera | null = null
export const rememberedCamera = () => lastBrowseCamera

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
      places: { type: "geojson", data: EMPTY, cluster: mode === "browse", clusterRadius: 56, clusterMaxZoom: 14 },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": "#0b0b10" } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": "#1a191f", "fill-antialias": false } },
      { id: "coast", type: "line", source: "coast", paint: { "line-color": "rgba(245,245,245,0.10)", "line-width": 0.6 } },
      { id: "borders", type: "line", source: "borders", paint: { "line-color": "rgba(245,245,245,0.06)", "line-width": 0.5 } },
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

export function viewOf(map: MLMap): MapView {
  const c = map.getCenter()
  return { zoom: map.getZoom(), center: { lat: c.lat, lng: c.lng }, bounds: boundsOf(map), bearing: map.getBearing() }
}

export function AroundMap(props: Props) {
  const { ref, className, label = "Map of places" } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const mlRef = useRef<typeof import("maplibre-gl") | null>(null)
  const markersRef = useRef(new Map<string, { marker: MLMarker; el: HTMLElement; sig: string }>())
  const rimRef = useRef<HTMLDivElement>(null)
  const reconcileRef = useRef<() => void>(() => {})
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })
  const [ready, setReady] = useState(false)
  const [attribution, setAttribution] = useState<"base" | "streets">("base")

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (camera) => {
        const map = mapRef.current
        if (!map) return
        const opts = { center: [camera.center.lng, camera.center.lat] as [number, number], zoom: camera.zoom, bearing: 0, pitch: 0 }
        if (reducedMotion()) map.jumpTo(opts)
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
      view: () => (mapRef.current ? viewOf(mapRef.current) : null),
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
    const fallback = (reason: "webgl" | "error") => {
      if (!disposed) propsRef.current.onFallback?.(reason)
    }

    void (async () => {
      if (!hasWebgl2()) return fallback("webgl")
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
          maxZoom: 18,
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
              leaves = src.getClusterLeaves(clusterId, 3, 0).then((ls) => ls.map((l) => ({ markText: String(l.properties?.markText ?? ""), markStyle: String(l.properties?.markStyle ?? ""), brand: String(l.properties?.brand ?? "") })))
              leafCache.set(key, leaves)
            }
            void leaves.then((ls) => fillCluster(el, ls, count)).catch(() => {})
          } else {
            el = placePin(props as unknown as PinProps, (id) => propsRef.current.onSelectPlace?.(id))
            setPinSelected(el, props.id === selected)
          }
          const marker = new ml.Marker({ element: el, anchor: "center", opacityWhenCovered: 0, subpixelPositioning: true }).setLngLat(coords).addTo(map)
          markers.set(key, { marker, el, sig: key })
        }
        for (const [key, m] of markers) {
          if (!seen.has(key)) {
            m.marker.remove()
            markers.delete(key)
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
      const schedule = () => {
        if (raf) return
        raf = requestAnimationFrame(() => {
          raf = 0
          reconcile()
          syncRim()
        })
      }

      /* ---- area labels from the gazetteer ---- */
      const cityLabels: MLMarker[] = []
      const hoodLabels: MLMarker[] = []
      for (const c of cities) {
        cityLabels.push(new ml.Marker({ element: areaLabel(c.name, "city"), anchor: "top", offset: [0, 4], opacityWhenCovered: 0 }).setLngLat([c.lng, c.lat]))
        for (const h of c.neighbourhoods) hoodLabels.push(new ml.Marker({ element: areaLabel(h.name, "neighbourhood"), anchor: "top", offset: [0, 4], opacityWhenCovered: 0 }).setLngLat([h.lng, h.lat]))
      }
      let shown: "none" | "city" | "hood" = "none"
      const syncLabels = () => {
        const z = map.getZoom()
        const want = z >= 11 ? "hood" : z >= 4 ? "city" : "none"
        if (want === shown) return
        shown = want
        for (const m of cityLabels) {
          if (want === "city") m.addTo(map)
          else m.remove()
        }
        for (const m of hoodLabels) {
          if (want === "hood") m.addTo(map)
          else m.remove()
        }
      }
      extra.push(...cityLabels, ...hoodLabels)

      map.on("load", () => {
        if (disposed) return
        setReady(true)
        syncLabels()
        const src = map.getSource("places") as GeoJSONSource | undefined
        if (mode === "browse") src?.setData(toFeatures(propsRef.current.places ?? []))
        propsRef.current.onView?.(viewOf(map), false)
        void enhance(map)
      })
      map.on("zoom", syncLabels)
      map.on("render", schedule)
      map.on("sourcedata", (e: { sourceId?: string }) => {
        if (e.sourceId === "places") schedule()
      })
      map.on("movestart", (e: MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
        if (e.originalEvent) propsRef.current.onUserMoveStart?.()
      })
      map.on("moveend", (e: MapLibreEvent<MouseEvent | TouchEvent | WheelEvent | undefined>) => {
        if (mode === "browse") {
          const c = map.getCenter()
          lastBrowseCamera = { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() }
        }
        propsRef.current.onView?.(viewOf(map), !!e.originalEvent)
        propsRef.current.onIdle?.()
      })
    })()

    /* ---- OpenFreeMap streets: progressive enhancement that fails quietly ---- */
    const OFM_LAYERS = ["ofm-water", "ofm-park", "ofm-landuse", "ofm-roads-minor", "ofm-roads-major", "ofm-roads-motorway", "ofm-buildings", "ofm-places"]
    function dropStreets(map: MLMap) {
      for (const id of OFM_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource("ofm")) map.removeSource("ofm")
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
        const before = "places-hit"
        const fill = (id: string, layer: string, color: string, filter?: unknown, minzoom = 5) =>
          map.addLayer({ id, type: "fill", source: "ofm", "source-layer": layer, minzoom, ...(filter ? { filter } : {}), paint: { "fill-color": color } } as never, before)
        const line = (id: string, classes: string[], color: string, width: number) =>
          map.addLayer({ id, type: "line", source: "ofm", "source-layer": "transportation", minzoom: 5, filter: ["in", ["get", "class"], ["literal", classes]], paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 8, width * 0.4, 16, width * 3] } } as never, before)
        fill("ofm-water", "water", "#0b0b10")
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
                layout: { "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 11 },
                paint: { "text-color": "#858585", "text-halo-color": "#080808", "text-halo-width": 1 },
              } as never,
              before,
            )
          }
        }
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

  // Selection → ring.
  const selectedId = props.selectedId
  useEffect(() => {
    if (!ready) return
    for (const [key, m] of markersRef.current) if (key.startsWith("p:")) setPinSelected(m.el, key === `p:${selectedId}`)
  }, [ready, selectedId])

  // The "you" dot: a DOM overlay at the precise point, never in the data source.
  const you = props.you
  useEffect(() => {
    const map = mapRef.current
    const ml = mlRef.current
    if (!ready || !map || !ml || !you) return
    const m = new ml.Marker({ element: youDot(), anchor: "center", opacityWhenCovered: 0 }).setLngLat([you.lng, you.lat]).addTo(map)
    return () => {
      m.remove()
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
      })
      pickMarker.current = m
    } else {
      const cur = pickMarker.current.getLngLat()
      if (Math.abs(cur.lat - pick.lat) > 1e-7 || Math.abs(cur.lng - pick.lng) > 1e-7) {
        pickMarker.current.setLngLat([pick.lng, pick.lat])
        if (!map.getBounds().contains([pick.lng, pick.lat])) map.jumpTo({ center: [pick.lng, pick.lat] })
      }
    }
  }, [ready, pick, props.mode])
  useEffect(
    () => () => {
      pickMarker.current?.remove()
      pickMarker.current = null
    },
    [],
  )

  return (
    <div className={cn("yard-around-map relative overflow-hidden", className)}>
      {/* MapLibre makes its container position: relative, so it fills an absolute wrapper. */}
      <div className="absolute inset-0">
        <div ref={containerRef} role="region" aria-label={label} className="h-full w-full" />
      </div>
      <div ref={rimRef} aria-hidden className="pointer-events-none absolute top-0 left-0 hidden rounded-full border border-purple/70" />
      <p className="pointer-events-none absolute right-2 bottom-1 z-[1] text-[10px] text-ink-3/80 [text-shadow:0_1px_2px_#080808]">
        Natural Earth{attribution === "streets" ? ", © OpenStreetMap contributors, OpenFreeMap" : ""}
      </p>
    </div>
  )
}

let logged = false
function logOnce(msg: string) {
  if (logged) return
  logged = true
  console.info(msg)
}
