"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { motion } from "motion/react"
import { CompassIcon, ListBulletsIcon, MapTrifoldIcon, MinusIcon, NavigationArrowIcon, PlusIcon, StorefrontIcon } from "@phosphor-icons/react"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { getPlace, getPlaces, placesKey } from "@/lib/api/around"
import { useApi } from "@/lib/api/use-api"
import { areaBySlug, type AreaHit } from "@/lib/around/gazetteer"
import { areaCamera, areaRadiusKm, cameraArea, cameraForFix, formatDistance, GLOBE_CAMERA, globeCamera, haversineKm, placesRequestFor, tileOf, type Bounds, type Frame } from "@/lib/around/geo"
import { notifyUrlChange, useSearchParam, writeParams } from "@/hooks/use-search-param"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { AreaSearch } from "./area-search"
import { readSavedArea, useAroundUi } from "./around-store"
import { applyFilters, emptyFilters, parseKinds, parseList, type Filters, type KindKey } from "./filters-model"
import { FiltersControl, KindChips } from "./filters"
import { ListView, type SortKey } from "./list-view"
import { useLocate } from "./locate"
import { AroundMap, rememberedCamera, type AroundMapHandle, type Camera, type Enhancement, type MapView } from "./map/around-map"
import { PlaceCard } from "./place-card"
import { PlaceDetail } from "./place-detail"
import { PlaceSheet } from "./place-sheet"
import { SvgWorldFallback } from "./svg-fallback"

/**
 * YARD Around (§6.4): a dark globe of brand places in the look of the owner's Snap Map screenshot
 * — clustered brand marks, the place's area as a title, an area pill, a row of nearby places
 * along the bottom and round controls on the right. Desktop adds a glass panel on the left.
 *
 * Privacy (§5.6): the server only ever sees 1° tile blocks or `scope=world`; a location fix stays
 * in this component's state, moves the camera to the area centroid (never the fix) and is never
 * written to the URL or storage. Only a manual area choice is remembered.
 */

const subscribeMedia = (q: string) => (cb: () => void) => {
  const m = window.matchMedia(q)
  m.addEventListener("change", cb)
  return () => m.removeEventListener("change", cb)
}
function useMedia(q: string) {
  return useSyncExternalStore(
    useMemo(() => subscribeMedia(q), [q]),
    () => window.matchMedia(q).matches,
    () => false,
  )
}

const inBounds = (p: { lat: number; lng: number }, b: Bounds) => {
  if (p.lat < b.south || p.lat > b.north) return false
  return b.west <= b.east ? p.lng >= b.west && p.lng <= b.east : p.lng >= b.west || p.lng <= b.east
}

/** The "you" dot's radius with its ring (pins.ts youDot: 16 px plus a 3 px ring), plus a pixel. */
const YOU_DOT_R = 12
/** `b` drawn in by `px` screen pixels at `zoom` (512 px tiles), so a marker that wide sits wholly inside it. */
function insetBy(b: Bounds, px: number, zoom: number, lat: number): Bounds {
  const dLng = (px * 360) / (512 * 2 ** zoom)
  const dLat = dLng * Math.cos((lat * Math.PI) / 180)
  return { west: b.west + dLng, east: b.east - dLng, south: b.south + dLat, north: b.north - dLat }
}

type Origin = { lat: number; lng: number; label: string }

/** Camera padding: the camera's centre sits in what the panel (desktop) or the carousel (phone) leaves free. */
const PAD_DESKTOP = { top: 120, right: 96, bottom: 48, left: 460 }
const PAD_PHONE = { top: 140, right: 72, bottom: 260, left: 32 }
/** What counts as "in view": not under the header, the panel, the control column or the carousel. */
const VIEW_DESKTOP = { top: 88, right: 88, bottom: 16, left: 436 }
const VIEW_PHONE = { top: 108, right: 68, bottom: 240, left: 8 }

/** The part of the map a camera frames on this screen (§5.6: the same for a manual choice and Locate). */
function frameNow(): Frame {
  const wide = window.matchMedia("(min-width: 1024px)").matches
  const pad = wide ? PAD_DESKTOP : PAD_PHONE
  return { w: window.innerWidth - pad.left - pad.right, h: window.innerHeight - pad.top - pad.bottom }
}

const WINDS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
/** Which way `to` lies from `from`, in eight winds. */
function windFrom(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const y = to.lat - from.lat
  const x = (to.lng - from.lng) * Math.cos((from.lat * Math.PI) / 180)
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  return WINDS[Math.round(deg / 45) % 8]
}

/**
 * The map route doesn't scroll: the page under it (the site footer) stays out of reach of a
 * wheel or swipe over the pill and carousel. A style element enabled while the route is shown and
 * disabled while Activity hides it, as Next's preserving-UI-state guide suggests for page styles.
 */
const lockPageScroll = (el: HTMLStyleElement | null) => {
  if (!el) return
  el.media = ""
  if (window.scrollY) window.scrollTo(0, 0)
  return () => {
    el.media = "not all"
  }
}

export function AroundApp() {
  const placeParam = useSearchParam("place")
  const viewParam = useSearchParam("view")
  const kindParam = useSearchParam("kind")
  const catParam = useSearchParam("cat")
  const areaParam = useSearchParam("area")
  const areaNonce = useAroundUi((s) => s.areaNonce)
  const setSearchOpen = useAroundUi((s) => s.setSearchOpen)
  const focusSearch = useAroundUi((s) => s.focusSearch)
  const desktop = useMedia("(min-width: 1024px)")
  const nowTick = useNow(30_000)
  const now = nowTick ?? 0

  const mapRef = useRef<AroundMapHandle>(null)
  const hydrated = useHydrated()
  // The first client render: the URL's area, else a saved manual area (never a fix), else the
  // camera this page had when it was left, else the globe. Rendered only after hydration.
  const [initial] = useState<{ camera: Camera; areaKey: string } | null>(() => {
    if (typeof window === "undefined") return null
    const a = areaBySlug(new URL(window.location.href).searchParams.get("area") ?? readSavedArea() ?? "")
    return { camera: a ? areaCamera(a, frameNow()) : (rememberedCamera() ?? globeCamera(window.matchMedia("(min-width: 1024px)").matches)), areaKey: a ? `${a.slug}:0` : "" }
  })
  const initialCamera = initial?.camera ?? null
  const [view, setView] = useState<MapView | null>(null)
  // What the carousel and the panel list are drawn from. It follows the camera, except for a
  // flight a card started: the rail then keeps its cards and order instead of re-sorting under
  // the shopper's thumb.
  const [basis, setBasis] = useState<MapView | null>(null)
  const cardFlight = useRef(false)
  const [enhancement, setEnhancement] = useState<Enhancement>("loading")
  const [fallback, setFallback] = useState(false)
  const [fix, setFix] = useState<{ lat: number; lng: number } | null>(null)
  const [fixArea, setFixArea] = useState<AreaHit | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [local, setLocal] = useState<Pick<Filters, "openNow" | "thisWeek" | "within">>({ openNow: false, thisWeek: false, within: null })
  const [sort, setSort] = useState<SortKey>("soon")
  const pushedPlace = useRef(false)
  const collapseTimer = useRef<number | undefined>(undefined)
  const carouselRef = useRef<HTMLDivElement>(null)

  const manualArea = useMemo(() => (areaParam ? areaBySlug(areaParam) : null), [areaParam])

  // A saved manual area also goes back into the URL, so the page and a reload agree.
  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("area")) return
    const saved = readSavedArea()
    if (saved) writeParams({ area: saved })
  }, [])

  // A manual area choice flies there (also when the same area is chosen again).
  // The area the page opened on is already the camera; any other choice (or the same one again) flies.
  const lastArea = useRef(initial?.areaKey ?? "")
  useEffect(() => {
    if (!initialCamera || !manualArea) return
    const key = `${manualArea.slug}:${areaNonce}`
    if (lastArea.current === key) return
    lastArea.current = key
    mapRef.current?.flyTo(areaCamera(manualArea, frameNow()))
  }, [manualArea, areaNonce, initialCamera])

  /* ---- data ---- */
  // The list (and the no-WebGL fallback) covers every city, so it reads the whole world.
  const listMode = viewParam === "list"
  const req = useMemo(() => (view && !listMode && !fallback ? placesRequestFor(view) : ({ scope: "world" } as const)), [view, listMode, fallback])
  const key = placesKey(req)
  const { data, error, revalidate } = useApi(hydrated ? key : null, () => getPlaces(req))
  const [known, setKnown] = useState<Map<string, PlaceSummaryDto>>(() => new Map())
  const [lastData, setLastData] = useState(data)
  if (data !== lastData) {
    setLastData(data)
    if (data) {
      const next = data.scope === "world" ? new Map<string, PlaceSummaryDto>() : new Map(known)
      if (data.scope === "tiles" && "tiles" in req) {
        const tiles = new Set(req.tiles)
        for (const [id, p] of next) if (tiles.has(tileOf(p.lat, p.lng))) next.delete(id)
      }
      for (const p of data.places) next.set(p.id, p)
      setKnown(next)
    }
  }
  const all = useMemo(() => [...known.values()], [known])
  const loading = !data && !error && all.length === 0

  /* ---- filters, origin and lists ---- */
  const filters: Filters = { kinds: parseKinds(kindParam), cats: parseList(catParam), ...local }
  const origin: Origin | null = fix ? { ...fix, label: "your location" } : manualArea ? { lat: manualArea.lat, lng: manualArea.lng, label: manualArea.name } : null
  const distanceEnabled = !!origin
  const effFilters = distanceEnabled ? filters : { ...filters, within: null }
  const oLat = fix ? fix.lat : areaParam ? (areaBySlug(areaParam)?.lat ?? null) : null
  const oLng = fix ? fix.lng : areaParam ? (areaBySlug(areaParam)?.lng ?? null) : null
  const kindsKey = kindParam ?? ""
  const catsKey = catParam ?? ""
  const { openNow, thisWeek } = local
  const within = distanceEnabled ? local.within : null
  const shownOnMap = useMemo(
    () => applyFilters(all, { kinds: parseKinds(kindsKey), cats: parseList(catsKey), openNow, thisWeek, within }, now, oLat !== null && oLng !== null ? { lat: oLat, lng: oLng } : null),
    [all, kindsKey, catsKey, openNow, thisWeek, within, now, oLat, oLng],
  )
  // "In view" leaves out what sits under the header, the panel, the control column or the carousel.
  const inView = useMemo(() => (basis && basis.zoom >= 4 ? shownOnMap.filter((p) => inBounds(p, basis.inner)) : shownOnMap), [shownOnMap, basis])
  const cLat = oLat ?? basis?.center.lat ?? GLOBE_CAMERA.center.lat
  const cLng = oLng ?? basis?.center.lng ?? GLOBE_CAMERA.center.lng
  // The rail and the panel list what's near, not only what fits on a phone's screen: the area's
  // places (the city or neighbourhood the camera is over) plus anything else in view, nearest
  // first from the shopper's location, their chosen area or the map's centre.
  const basisArea = basis ? cameraArea(basis.center.lat, basis.center.lng, basis.zoom) : null
  const listArea = basisArea && (basisArea.level === "city" || basisArea.level === "neighbourhood") ? basisArea.area : null
  const areaPlaces = useMemo(() => (listArea ? shownOnMap.filter((p) => haversineKm(listArea.lat, listArea.lng, p.lat, p.lng) <= areaRadiusKm(listArea)) : []), [listArea, shownOnMap])
  const near = useMemo(() => {
    const ids = new Set(inView.map((p) => p.id))
    const merged = [...inView, ...areaPlaces.filter((p) => !ids.has(p.id))]
    return merged.sort((a, b) => haversineKm(cLat, cLng, a.lat, a.lng) - haversineKm(cLat, cLng, b.lat, b.lng)).slice(0, 40)
  }, [inView, areaPlaces, cLat, cLng])
  const listLabel = listArea && areaPlaces.length ? `near ${listArea.label}` : "in view"

  const setKinds = (kinds: KindKey[]) => writeParams({ kind: kinds.length ? kinds.join(",") : null })
  const setFilters = (f: Filters) => {
    writeParams({ kind: f.kinds.length ? f.kinds.join(",") : null, cat: f.cats.length ? f.cats.join(",") : null })
    setLocal({ openNow: f.openNow, thisWeek: f.thisWeek, within: f.within })
  }
  const toggleKind = (k: KindKey) => setKinds(filters.kinds.includes(k) ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k])
  const filtered = filters.kinds.length + filters.cats.length > 0 || local.openNow || local.thisWeek || !!local.within

  /* ---- the camera's area: title and pill ---- */
  const camArea = view ? cameraArea(view.center.lat, view.center.lng, view.zoom) : { level: "earth" as const }
  const openSummary = placeParam ? (known.get(placeParam) ?? null) : null
  // While a place is open the title names that place's area: on a phone the camera's centre sits
  // under the sheet, so the centre's area would be the wrong neighbourhood.
  const title = openSummary ? (openSummary.neighbourhood ?? openSummary.city) : camArea.level === "earth" ? "Earth" : camArea.level === "country" ? camArea.name : camArea.area.name
  const pillArea = camArea.level === "city" || camArea.level === "neighbourhood" ? camArea.area : null
  const pillPlaces = useMemo(() => (pillArea ? shownOnMap.filter((p) => haversineKm(pillArea.lat, pillArea.lng, p.lat, p.lng) <= areaRadiusKm(pillArea)) : []), [pillArea, shownOnMap])
  const pillBrands = new Set(pillPlaces.map((p) => p.brand.id)).size
  // While the area's places are still loading the pill says so, never "No brands" too early.
  const pillText = pillArea ? (pillBrands ? `${pillBrands} ${pillBrands === 1 ? "brand" : "brands"} near ${pillArea.label}` : loading ? `Loading places near ${pillArea.label}…` : `No brands near ${pillArea.label} yet`) : "Pick your city"
  const onPill = () => {
    if (pillArea && pillPlaces.length) mapRef.current?.fitTo(pillPlaces.map((p) => ({ lat: p.lat, lng: p.lng })))
    else if (desktop) focusSearch()
    else setSearchOpen(true)
  }

  /* ---- selection ---- */
  const selectedSummary = placeParam ? (known.get(placeParam) ?? null) : null
  const detailQ = useApi(placeParam ? `around:place:${placeParam}` : null, () => getPlace(placeParam!))
  const detail = detailQ.data?.place && detailQ.data.place.id === placeParam ? detailQ.data.place : null
  const flownFor = useRef<string | null>(null)
  const mapLoaded = view !== null
  useEffect(() => {
    const p = detail ?? selectedSummary
    // Only once the map has reported a view (it has loaded), so a deep link always flies.
    if (!p || !placeParam || flownFor.current === placeParam || !mapLoaded) return
    flownFor.current = placeParam
    const v = mapRef.current?.view()
    if (v && v.zoom >= 9 && inBounds(p, v.bounds)) return
    mapRef.current?.flyTo({ center: { lat: p.lat, lng: p.lng }, zoom: Math.max(v?.zoom ?? 0, 13) })
  }, [detail, selectedSummary, placeParam, mapLoaded])

  const openPlace = useCallback((id: string) => {
    const url = new URL(window.location.href)
    if (url.searchParams.get("place") === id) return
    const had = url.searchParams.has("place")
    url.searchParams.set("place", id)
    url.searchParams.delete("view")
    const target = `${url.pathname}${url.search}`
    // Opening pushes an entry, so Back closes the place; switching between places replaces it.
    if (had && pushedPlace.current) window.history.replaceState(window.history.state, "", target)
    else {
      window.history.pushState(window.history.state, "", target)
      pushedPlace.current = true
    }
    notifyUrlChange()
  }, [])
  const closePlace = useCallback(() => {
    if (pushedPlace.current) {
      pushedPlace.current = false
      window.history.back()
    } else writeParams({ place: null })
  }, [])
  useEffect(() => {
    if (!placeParam) pushedPlace.current = false
  }, [placeParam])

  const onPin = useCallback(
    (id: string) => {
      if (window.matchMedia("(min-width: 1024px)").matches) openPlace(id)
      else {
        setFocusId(id)
        setCollapsed(false)
        requestAnimationFrame(() => carouselRef.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", inline: "start", block: "nearest" }))
      }
    },
    [openPlace],
  )

  const onView = useCallback((v: MapView, user: boolean) => {
    setView(v)
    if (cardFlight.current && !user) {
      cardFlight.current = false
      return
    }
    cardFlight.current = false
    setBasis(v)
  }, [])

  // Phone, one tap on a card (owner review 2026-11-07, Snap Map feel): select its pin, fly it into
  // the strip of map above the sheet, and open the sheet.
  const openFromCard = useCallback(
    (p: PlaceSummaryDto) => {
      setFocusId(p.id)
      const v = mapRef.current?.view()
      const h = window.innerHeight
      // The map's padded centre sits at (top 140, bottom 260); the sheet covers the lower 64 dvh.
      const paddedCentre = 140 + (h - 400) / 2
      const aboveSheet = (88 + h * 0.36) / 2
      cardFlight.current = true
      flownFor.current = p.id
      mapRef.current?.flyTo({ center: { lat: p.lat, lng: p.lng }, zoom: Math.max(v?.zoom ?? 0, 13) }, { offset: [0, Math.round(aboveSheet - paddedCentre)] })
      openPlace(p.id)
    },
    [openPlace],
  )

  /* ---- Locate ---- */
  const onFix = useCallback((pos: { lat: number; lng: number }) => {
    setFix(pos)
    const cam = cameraForFix(pos.lat, pos.lng, frameNow())
    setFixArea(cam.area)
    // A fix never reaches the URL: a manual area there would now be stale, so it goes.
    if (new URL(window.location.href).searchParams.has("area")) writeParams({ area: null })
    mapRef.current?.flyTo({ center: cam.center, zoom: cam.zoom })
  }, [])
  const locate = useLocate(onFix, () => (desktop ? focusSearch() : setSearchOpen(true)))

  /* ---- carousel collapse while the map is dragged (§6.4) ---- */
  const onUserMoveStart = useCallback(() => {
    window.clearTimeout(collapseTimer.current)
    setCollapsed(true)
  }, [])
  const onIdle = useCallback(() => {
    window.clearTimeout(collapseTimer.current)
    collapseTimer.current = window.setTimeout(() => setCollapsed(false), 600)
  }, [])
  useEffect(() => () => window.clearTimeout(collapseTimer.current), [])

  const distanceTo = (p: { lat: number; lng: number }) => (origin ? { km: haversineKm(origin.lat, origin.lng, p.lat, p.lng), from: origin.label } : null)
  const cityForList = manualArea?.city ?? fixArea?.city ?? (camArea.level === "city" || camArea.level === "neighbourhood" ? camArea.area.city : null)
  const listCity = cityForList ? { slug: cityForList.slug, name: cityForList.name } : null
  const listPlaces = listMode || fallback ? applyFilters(all, effFilters, now, origin) : []

  const emptyView = !loading && !error && basis && basis.zoom >= 4 && inView.length === 0
  // The "you" dot isn't wholly in view (the camera went to the area, not the fix): the dot isn't drawn
  // under the controls, header or carousel or cut off at the edge; the hint says where it is instead.
  const youHint =
    fix && view && view.zoom >= 4 && !inBounds(fix, insetBy(view.inner, YOU_DOT_R, view.zoom, view.center.lat))
      ? `You're ${formatDistance(haversineKm(view.center.lat, view.center.lng, fix.lat, fix.lng))} ${windFrom(view.center, fix)} of the map centre`
      : null

  /* ---------- render ---------- */

  const kindChips = <KindChips kinds={filters.kinds} onToggle={toggleKind} />
  const errorPill = error ? (
    <div role="alert" className="glass pointer-events-auto inline-flex items-center gap-2 rounded-full py-1 pr-1 pl-3.5 text-[13px] text-ink">
      Couldn&apos;t load places.
      <Button size="sm" variant="ghost" onClick={() => void revalidate()} className="h-8 rounded-full">
        Retry
      </Button>
    </div>
  ) : null

  if (fallback) {
    return (
      <div className="min-h-dvh">
        <ListView
          header={
            <div className="grid gap-4">
              <h1 className="font-display text-display-sm text-ink">{listCity ? `Around ${listCity.name}` : "Around"}</h1>
              {/* The same search, Locate and Filters as the list, so distance and area search work without WebGL. */}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 lg:max-w-md">
                  <AreaSearch variant="inline" />
                </div>
                <Button variant="secondary" size="icon" className="size-10 shrink-0 rounded-full" aria-label="Show places near you" aria-busy={locate.locating || undefined} onClick={() => void locate.start()}>
                  <NavigationArrowIcon className={cn("size-5", fix && "text-violet", locate.locating && "animate-pulse motion-reduce:animate-none")} weight={fix ? "fill" : "regular"} aria-hidden />
                </Button>
                <FiltersControl filters={filters} onChange={setFilters} distanceEnabled={distanceEnabled} resultCount={listPlaces.length} phone={!desktop} open={filtersOpen} onOpenChange={setFiltersOpen} />
              </div>
              <SvgWorldFallback places={shownOnMap} selectedCity={listCity?.slug} onCity={(slug) => document.getElementById(`city-${slug}`)?.scrollIntoView({ block: "start" })} />
              {kindChips}
            </div>
          }
          places={listPlaces}
          loading={loading}
          error={error}
          onRetry={() => void revalidate()}
          now={now}
          origin={origin}
          city={listCity}
          sort={sort}
          onSort={setSort}
          distanceEnabled={distanceEnabled}
          onOpen={(id) => openPlace(id)}
          filtered={filtered}
          onClearFilters={() => setFilters(emptyFilters)}
        />
        <PlaceSheet open={!!placeParam} onClose={closePlace} summary={selectedSummary} detail={detail} loading={detailQ.isLoading} error={detailQ.error} onRetry={() => void detailQ.revalidate()} now={now} distance={detail ? distanceTo(detail) : null} />
        {locate.sheets}
      </div>
    )
  }

  const control = "glass inline-flex size-11 items-center justify-center rounded-full text-ink outline-none focus-visible:ring-2 focus-visible:ring-violet active:scale-95 motion-reduce:active:scale-100"
  const mapToggle = (
    <Tip label={listMode ? "Map" : "List"}>
      <button type="button" aria-label={listMode ? "Show the map" : "Show the list"} className={control} onClick={() => writeParams({ view: listMode ? null : "list", place: null })}>
        {listMode ? <MapTrifoldIcon className="size-5" aria-hidden /> : <ListBulletsIcon className="size-5" aria-hidden />}
      </button>
    </Tip>
  )
  const locateBtn = (
    <Tip label="Locate">
      <button type="button" aria-label="Show places near you" aria-busy={locate.locating || undefined} className={cn(control, fix && "text-violet")} onClick={() => void locate.start()}>
        <NavigationArrowIcon className={cn("size-5", locate.locating && "animate-pulse motion-reduce:animate-none")} weight={fix ? "fill" : "regular"} aria-hidden />
      </button>
    </Tip>
  )
  const filtersBtn = <FiltersControl filters={filters} onChange={setFilters} distanceEnabled={distanceEnabled} resultCount={inView.length} phone={!desktop} open={filtersOpen} onOpenChange={setFiltersOpen} />

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#050505]" data-around-root>
      <style ref={lockPageScroll}>{"html,body{overflow:hidden;overscroll-behavior:none}"}</style>
      {hydrated && initialCamera ? (
        <AroundMap
          ref={mapRef}
          mode="browse"
          initialCamera={initialCamera}
          places={shownOnMap}
          selectedId={desktop ? placeParam : (focusId ?? placeParam)}
          onSelectPlace={onPin}
          onView={onView}
          onUserMoveStart={onUserMoveStart}
          onIdle={onIdle}
          onEnhancement={setEnhancement}
          onFallback={() => setFallback(true)}
          you={youHint ? null : fix}
          padding={desktop ? PAD_DESKTOP : PAD_PHONE}
          viewInsets={desktop ? VIEW_DESKTOP : VIEW_PHONE}
          // Phones: the home bar, carousel and pill fill the bottom, so credits go under the header.
          creditsClassName={desktop ? undefined : "top-[116px] right-auto bottom-auto left-4 flex-row-reverse items-center"}
          compactCredits={!desktop}
          // Names stay out from under the header and the title (and the panel on desktop).
          // The control column marks itself as hard chrome (data-map-chrome) as well.
          labelInsets={desktop ? { top: 150, left: 448 } : { top: 108, right: 72, bottom: 240 }}
          className={cn("absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none", listMode && "invisible")}
          label="Map of brand places"
        />
      ) : null}
      <span className="sr-only" aria-live="polite">
        {enhancement === "ready" ? "Street map loaded." : ""}
      </span>

      {listMode && !desktop ? <div className="absolute right-4 bottom-[calc(var(--tabbar-clear,6.25rem)+12px)] z-30">{mapToggle}</div> : null}
      {listMode ? (
        <div className="absolute inset-0 overflow-y-auto bg-obsidian">
          <ListView
            header={
              <div className="grid gap-4">
                <div className="flex items-end justify-between gap-4">
                  <h1 className="font-display text-display-sm text-ink">{listCity ? `Around ${listCity.name}` : "Around"}</h1>
                  <div className="hidden lg:block">{mapToggle}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 lg:max-w-md">
                    <AreaSearch variant="inline" />
                  </div>
                  {filtersBtn}
                </div>
                {kindChips}
              </div>
            }
            places={listPlaces}
            loading={loading}
            error={error}
            onRetry={() => void revalidate()}
            now={now}
            origin={origin}
            city={listCity}
            sort={sort}
            onSort={setSort}
            distanceEnabled={distanceEnabled}
            onOpen={openPlace}
            filtered={filtered}
            onClearFilters={() => setFilters(emptyFilters)}
          />
        </div>
      ) : null}

      {!listMode ? (
        <>
          {/* The Snap-style title: Earth, a country, a city or a neighbourhood. */}
          <p data-map-chrome className="pointer-events-none absolute top-[72px] right-4 z-10 max-w-[60%] truncate text-right font-display text-[2rem] leading-none text-ink [text-shadow:0_2px_12px_#080808] lg:top-24 lg:right-6 lg:text-[2.75rem]">
            {title}
          </p>

          {desktop ? (
            <DesktopPanel>
              {placeParam ? (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
                  <PlaceDetail summary={selectedSummary} detail={detail} loading={detailQ.isLoading} error={detailQ.error} onRetry={() => void detailQ.revalidate()} onBack={closePlace} now={now} distance={detail ? distanceTo(detail) : selectedSummary ? distanceTo(selectedSummary) : null} />
                </div>
              ) : (
                <>
                  <div className="grid gap-3 p-4 pb-2">
                    <AreaSearch variant="inline" />
                    {kindChips}
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-ink" aria-live="polite">
                        {loading ? "Loading places…" : near.length === 1 ? "1 place" : `${near.length} places`}
                        {basis && basis.zoom >= 4 && !loading ? <span className="text-ink-2"> {listLabel}</span> : null}
                      </p>
                      {errorPill}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
                    {loading ? <CardSkeletons /> : null}
                    {emptyView ? (
                      pillPlaces.length ? (
                        <div className="grid justify-items-start gap-2 px-2 py-6 text-sm text-ink-2">
                          <p>None of the places near {pillArea?.label} are in view.</p>
                          <Button size="sm" variant="secondary" onClick={onPill}>
                            Show {pillPlaces.length === 1 ? "it" : `all ${pillPlaces.length}`}
                          </Button>
                        </div>
                      ) : (
                        <p className="px-2 py-6 text-sm text-ink-2">No places here yet. Zoom out or pick another city.</p>
                      )
                    ) : null}
                    <ul className="grid gap-0.5">
                      {near.map((p) => (
                        <li key={p.id}>
                          <PlaceCard place={p} now={now} distanceKm={origin ? haversineKm(origin.lat, origin.lng, p.lat, p.lng) : null} onSelect={() => openPlace(p.id)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </DesktopPanel>
          ) : null}

          {/* Right-hand controls (desktop: bottom-aligned column; phone: above the carousel). */}
          <div data-map-chrome className={cn("absolute right-4 z-20 flex flex-col items-end gap-2 lg:right-6 lg:bottom-6", "bottom-[calc(var(--tabbar-clear,6.25rem)+108px)] lg:bottom-6")}>
            {!desktop ? <AreaSearch variant="circle" placement="page" className="size-11" /> : null}
            {locateBtn}
            {filtersBtn}
            {desktop ? (
              <>
                <Tip label="Zoom in">
                  <button type="button" aria-label="Zoom in" className={control} onClick={() => mapRef.current?.zoomBy(1)}>
                    <PlusIcon className="size-5" aria-hidden />
                  </button>
                </Tip>
                <Tip label="Zoom out">
                  <button type="button" aria-label="Zoom out" className={control} onClick={() => mapRef.current?.zoomBy(-1)}>
                    <MinusIcon className="size-5" aria-hidden />
                  </button>
                </Tip>
                {view && Math.abs(view.bearing) > 0.5 ? (
                  <Tip label="Reset north">
                    <button type="button" aria-label="Reset north" className={control} onClick={() => mapRef.current?.resetNorth()}>
                      <CompassIcon className="size-5" style={{ transform: `rotate(${-view.bearing}deg)` }} aria-hidden />
                    </button>
                  </Tip>
                ) : null}
              </>
            ) : null}
            {mapToggle}
          </div>

          {/* The area pill: informational, so glass and ink with a violet icon — not purple. */}
          <div className={cn("pointer-events-none absolute left-4 z-20 flex max-w-[calc(100%-5.5rem)] flex-col items-start gap-2", "bottom-[calc(var(--tabbar-clear,6.25rem)+108px)] lg:bottom-6 lg:left-[448px]")}>
            {!desktop ? errorPill : null}
            {youHint ? <p className="glass rounded-full px-3.5 py-2 text-[13px] text-ink">{youHint}</p> : null}
            {emptyView && !desktop ? (
              pillPlaces.length ? (
                <button type="button" onClick={onPill} className="glass pointer-events-auto inline-flex h-10 items-center rounded-full px-3.5 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-violet">
                  None in view. Show the {pillPlaces.length === 1 ? "1 place" : `${pillPlaces.length} places`} nearby
                </button>
              ) : (
                <p className="glass rounded-full px-3.5 py-2 text-[13px] text-ink">No places here yet. Zoom out or pick another city.</p>
              )
            ) : null}
            <button type="button" onClick={onPill} className="pointer-events-auto inline-flex h-10 max-w-full items-center gap-2 rounded-full border border-white/10 bg-obsidian/70 px-3.5 text-[13px] text-ink backdrop-blur-xl outline-none focus-visible:ring-2 focus-visible:ring-violet">
              <StorefrontIcon weight="fill" className="size-4 shrink-0 text-violet" aria-hidden />
              <span className="truncate">{pillText}</span>
            </button>
          </div>

          {/* Phone: the bottom carousel of nearby places. It collapses while the map is dragged. */}
          {!desktop ? (
            <motion.div
              initial={false}
              animate={collapsed ? { y: 24, opacity: 0 } : { y: 0, opacity: 1 }}
              transition={{ duration: duration.drawer, ease: ease.out }}
              aria-hidden={collapsed || undefined}
              inert={collapsed}
              className="absolute inset-x-0 bottom-[var(--tabbar-clear,6.25rem)] z-20"
              data-collapsed={collapsed ? "true" : "false"}
            >
              <div ref={carouselRef} role="list" aria-label="Places nearby" className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                {loading ? (
                  <CardSkeletons row />
                ) : (
                  near.map((p) => (
                    <div role="listitem" key={p.id} data-card={p.id}>
                      <PlaceCard
                        variant="carousel"
                        place={p}
                        now={now}
                        distanceKm={origin ? haversineKm(origin.lat, origin.lng, p.lat, p.lng) : null}
                        selected={focusId === p.id}
                        onSelect={() => openFromCard(p)}
                      />
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          ) : null}
        </>
      ) : null}

      {!desktop ? <PlaceSheet open={!!placeParam} onClose={closePlace} summary={selectedSummary} detail={detail} loading={detailQ.isLoading} error={detailQ.error} onRetry={() => void detailQ.revalidate()} now={now} distance={detail ? distanceTo(detail) : selectedSummary ? distanceTo(selectedSummary) : null} /> : null}
      {locate.sheets}
    </div>
  )
}

function DesktopPanel({ children }: { children: React.ReactNode }) {
  return <aside aria-label="Places" className="glass absolute top-24 bottom-6 left-6 z-20 flex w-[400px] flex-col overflow-hidden rounded-2xl">{children}</aside>
}

function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}

function CardSkeletons({ row = false }: { row?: boolean }) {
  return (
    <div role="status" aria-label="Loading places" className={cn(row ? "flex gap-3" : "grid gap-1 px-2")}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={cn("skeleton block rounded-2xl", row ? "h-24 w-[248px] shrink-0" : "h-[76px]")} />
      ))}
    </div>
  )
}
