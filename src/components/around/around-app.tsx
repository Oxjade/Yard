"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { motion } from "motion/react"
import { CompassIcon, ListBulletsIcon, MapTrifoldIcon, MinusIcon, NavigationArrowIcon, PlusIcon, StorefrontIcon } from "@phosphor-icons/react"
import type { PlaceSummaryDto } from "@/lib/api/contracts/around"
import { getPlace, getPlaces, placesKey } from "@/lib/api/around"
import { useApi } from "@/lib/api/use-api"
import { areaBySlug, type AreaHit } from "@/lib/around/gazetteer"
import { areaCamera, areaRadiusKm, cameraArea, cameraForFix, GLOBE_CAMERA, globeCamera, haversineKm, placesRequestFor, tileOf, type Bounds } from "@/lib/around/geo"
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

type Origin = { lat: number; lng: number; label: string }

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
    return { camera: a ? areaCamera(a) : (rememberedCamera() ?? globeCamera(window.matchMedia("(min-width: 1024px)").matches)), areaKey: a ? `${a.slug}:0` : "" }
  })
  const initialCamera = initial?.camera ?? null
  const [view, setView] = useState<MapView | null>(null)
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
    mapRef.current?.flyTo(areaCamera(manualArea))
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
  const inView = useMemo(() => (view && view.zoom >= 4 ? shownOnMap.filter((p) => inBounds(p, view.bounds)) : shownOnMap), [shownOnMap, view])
  const cLat = oLat ?? view?.center.lat ?? GLOBE_CAMERA.center.lat
  const cLng = oLng ?? view?.center.lng ?? GLOBE_CAMERA.center.lng
  const near = useMemo(() => [...inView].sort((a, b) => haversineKm(cLat, cLng, a.lat, a.lng) - haversineKm(cLat, cLng, b.lat, b.lng)).slice(0, 40), [inView, cLat, cLng])

  const setKinds = (kinds: KindKey[]) => writeParams({ kind: kinds.length ? kinds.join(",") : null })
  const setFilters = (f: Filters) => {
    writeParams({ kind: f.kinds.length ? f.kinds.join(",") : null, cat: f.cats.length ? f.cats.join(",") : null })
    setLocal({ openNow: f.openNow, thisWeek: f.thisWeek, within: f.within })
  }
  const toggleKind = (k: KindKey) => setKinds(filters.kinds.includes(k) ? filters.kinds.filter((x) => x !== k) : [...filters.kinds, k])
  const filtered = filters.kinds.length + filters.cats.length > 0 || local.openNow || local.thisWeek || !!local.within

  /* ---- the camera's area: title and pill ---- */
  const camArea = view ? cameraArea(view.center.lat, view.center.lng, view.zoom) : { level: "earth" as const }
  const title = camArea.level === "earth" ? "Earth" : camArea.level === "country" ? camArea.name : camArea.area.name
  const pillArea = camArea.level === "city" || camArea.level === "neighbourhood" ? camArea.area : null
  const pillPlaces = useMemo(() => (pillArea ? shownOnMap.filter((p) => haversineKm(pillArea.lat, pillArea.lng, p.lat, p.lng) <= areaRadiusKm(pillArea)) : []), [pillArea, shownOnMap])
  const pillBrands = new Set(pillPlaces.map((p) => p.brand.id)).size
  const pillText = pillArea ? (pillBrands ? `${pillBrands} ${pillBrands === 1 ? "brand" : "brands"} near ${pillArea.label}` : `No brands near ${pillArea.label} yet`) : "Pick your city"
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

  /* ---- Locate ---- */
  const onFix = useCallback((pos: { lat: number; lng: number }) => {
    setFix(pos)
    const cam = cameraForFix(pos.lat, pos.lng)
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

  const emptyView = !loading && !error && view && view.zoom >= 4 && inView.length === 0

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
              <h1 className="font-display text-display-sm text-ink">Around</h1>
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
      {hydrated && initialCamera ? (
        <AroundMap
          ref={mapRef}
          mode="browse"
          initialCamera={initialCamera}
          places={shownOnMap}
          selectedId={desktop ? placeParam : (focusId ?? placeParam)}
          onSelectPlace={onPin}
          onView={(v) => setView(v)}
          onUserMoveStart={onUserMoveStart}
          onIdle={onIdle}
          onEnhancement={setEnhancement}
          onFallback={() => setFallback(true)}
          you={fix}
          padding={desktop ? { top: 120, right: 96, bottom: 48, left: 460 } : { top: 140, right: 72, bottom: 260, left: 32 }}
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
          <p className="pointer-events-none absolute top-[72px] right-4 z-10 max-w-[60%] truncate text-right font-display text-[2rem] leading-none text-ink [text-shadow:0_2px_12px_#080808] lg:top-24 lg:right-6 lg:text-[2.75rem]">
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
                        {loading ? "Loading places…" : inView.length === 1 ? "1 place" : `${inView.length} places`}
                        {view && view.zoom >= 4 ? <span className="text-ink-2"> in view</span> : null}
                      </p>
                      {errorPill}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
                    {loading ? <CardSkeletons /> : null}
                    {emptyView ? <p className="px-2 py-6 text-sm text-ink-2">No places here yet. Zoom out or pick another city.</p> : null}
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
          <div className={cn("absolute right-4 z-20 flex flex-col items-end gap-2 lg:right-6 lg:bottom-6", "bottom-[calc(var(--tabbar-clear,6.25rem)+108px)] lg:bottom-6")}>
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
            {emptyView && !desktop ? <p className="glass rounded-full px-3.5 py-2 text-[13px] text-ink">No places here yet. Zoom out or pick another city.</p> : null}
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
                        onSelect={() => {
                          if (focusId === p.id) openPlace(p.id)
                          else {
                            setFocusId(p.id)
                            mapRef.current?.flyTo({ center: { lat: p.lat, lng: p.lng }, zoom: Math.max(view?.zoom ?? 0, 13) })
                          }
                        }}
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
