"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "motion/react"
import { ArrowLeftIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { dateRangeProblems, MARKET_COUNTRIES, outcomeCopy, type LocationWriteBody, type StudioLocationDto, type StudioLocationsResult } from "@/lib/api/contracts/around"
import { createStudioLocation, getStudioLocation, listStudioLocations, STUDIO_LOCATIONS_KEY, updateStudioLocation } from "@/lib/api/around"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { cities, cityBySlug, haversineKm } from "@/lib/around/gazetteer"
import { countryName } from "@/lib/around/geo"
import { otherCityPinProblem } from "@/lib/around/markets"
import { localParts, zonedTimeToUtc, zoneShort, type PlaceHours } from "@/lib/around/hours"
import { isDatedKind, kindLabel, type LocationKind } from "@/lib/around/labels"
import { countryTimeZone } from "@/lib/data/zones"
import { products } from "@/lib/data/products"
import type { CountryCode } from "@/config/markets"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Enhancement } from "@/components/around/map/around-map"
import { MediaUploader } from "@/components/media/media-uploader"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { SessionGate } from "@/components/session/session-gate"
import { Field, Panel, Segmented, control, inputClass, selectClass } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SampleChip } from "@/components/ui/sample-chip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { EventsSection } from "./events-section"
import { defaultHours, HoursEditor } from "./hours-editor"
import { PhotoList, ProductPicker, type PhotoItem } from "./pickers"
import { PickMap } from "./pick-map"
import { placeStatusMeta } from "./status"

/**
 * LocationForm (§6.4 Studio Locations), in the Settings section-nav pattern. Pick mode uses
 * Yard's bundled map and says honestly when street tiles didn't load; a pin is street-precise
 * only when the street map was loaded or the coordinates were typed. Photos travel as media ids
 * and alt text only.
 */

const OTHER = "__other"
type Visibility = "draft" | "published" | "hidden"

type FormState = {
  kind: LocationKind
  name: string
  description: string
  citySlug: string
  hoodSlug: string
  hoodName: string
  cityName: string
  country: CountryCode
  addressLine: string
  lat: number
  lng: number
  latText: string
  lngText: string
  pinMoved: boolean
  typed: boolean
  hours: PlaceHours
  byAppointment: boolean
  hoursNote: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  images: PhotoItem[]
  featured: string[]
  visibility: Visibility
}

const sections = [
  { id: "basics", label: "Basics" },
  { id: "map", label: "On the map" },
  { id: "hours", label: "Hours" },
  { id: "photos", label: "Photos" },
  { id: "featured", label: "Featured pieces" },
  { id: "events", label: "Events" },
  { id: "visibility", label: "Visibility" },
] as const

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/** A typed coordinate in decimal degrees within [min, max], or null ("6,45" reads as 6.45). */
function parseCoord(text: string, min: number, max: number) {
  const t = text.trim().replace(",", ".")
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
const COORD_HELP = "Use decimal degrees: latitude from -90 to 90, longitude from -180 to 180."

/**
 * False while Next hides this route with Activity (Cache Components keeps up to 3 routes in the
 * DOM, display:none). The form unmounts while hidden, so /new always opens clean (it never keeps
 * the place it just created) and no hidden copy of the form shares ids (#basics, #loc-lat…) with
 * the visible one. A layout effect, so a re-shown route renders before paint with no stale flash.
 */
function useRouteShown() {
  const [shown, setShown] = useState(true)
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-shown by Activity: mount the form again
    setShown(true)
    return () => setShown(false)
  }, [])
  return shown
}

function initialFor(loc: StudioLocationDto | null, brand: StudioLocationsResult["brand"]): FormState {
  if (loc) {
    const tz = loc.timeZone
    const s = loc.startsAt ? localParts(loc.startsAt, tz) : null
    const e = loc.endsAt ? localParts(loc.endsAt, tz) : null
    return {
      kind: loc.kind,
      name: loc.name,
      description: loc.description ?? "",
      citySlug: loc.inGazetteer ? loc.citySlug : OTHER,
      hoodSlug: loc.neighbourhoodSlug ?? (loc.neighbourhood ? OTHER : ""),
      hoodName: loc.neighbourhoodSlug ? "" : (loc.neighbourhood ?? ""),
      cityName: loc.inGazetteer ? "" : loc.city,
      country: loc.country as CountryCode,
      addressLine: loc.addressLine,
      lat: loc.lat,
      lng: loc.lng,
      latText: String(loc.lat),
      lngText: String(loc.lng),
      pinMoved: false,
      typed: false,
      hours: loc.hours ?? defaultHours(),
      byAppointment: loc.byAppointment,
      hoursNote: loc.hoursNote ?? "",
      startDate: s?.date ?? "",
      startTime: s?.time ?? "12:00",
      endDate: e?.date ?? "",
      endTime: e?.time ?? "18:00",
      images: loc.images.filter((i) => i.mediaId).map((i) => ({ mediaId: i.mediaId!, src: i.src, alt: i.alt })),
      featured: loc.featuredProductIds,
      visibility: loc.visibility,
    }
  }
  const city = cityBySlug(brand.citySlug) ?? cities[0]
  return {
    kind: "store",
    name: "",
    description: "",
    citySlug: city.slug,
    hoodSlug: "",
    hoodName: "",
    cityName: "",
    country: city.country as CountryCode,
    addressLine: "",
    lat: city.lat,
    lng: city.lng,
    latText: String(city.lat),
    lngText: String(city.lng),
    pinMoved: false,
    typed: false,
    hours: defaultHours(),
    byAppointment: false,
    hoursNote: "",
    startDate: "",
    startTime: "12:00",
    endDate: "",
    endTime: "18:00",
    images: [],
    featured: [],
    visibility: "draft",
  }
}

export function LocationFormPage({ id }: { id: string | null }) {
  const shown = useRouteShown()
  if (!shown) return null
  return (
    <SessionGate surface="studio" permission="locations.manage" feature="Locations">
      <LocationFormLoader id={id} />
    </SessionGate>
  )
}

function LocationFormLoader({ id }: { id: string | null }) {
  const list = useApi<StudioLocationsResult>(STUDIO_LOCATIONS_KEY, () => listStudioLocations())
  const one = useApi(id ? `studio:location:${id}` : null, () => getStudioLocation(id!))
  const title = id ? "Edit location" : "Add location"
  const failed = (id && one.error) || list.error
  if (failed) {
    const notFound = id && (one.error as { status?: number } | undefined)?.status === 404
    return (
      <div className="grid gap-6">
        <PageHeader title={title} />
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-line-soft bg-card p-5">
          <p className="text-sm text-ink">{notFound ? "This location isn't one of yours, or it was deleted." : "Couldn't load this location."}</p>
          {notFound ? (
            <Button asChild size="sm" variant="secondary">
              <Link href="/studio/locations">Back to locations</Link>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void list.revalidate()
                if (id) void one.revalidate()
              }}
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    )
  }
  const ready = !!list.data && (!id || !!one.data)
  if (!ready) return <FormSkeleton title={title} />
  return <LocationForm key={id ?? "new"} loc={one.data?.location ?? null} brand={list.data!.brand} />
}

function FormSkeleton({ title }: { title: string }) {
  return (
    <div className="grid gap-6">
      <PageHeader title={title} actions={<Button size="sm" variant="primary" disabled>Save</Button>} />
      <div role="status" aria-label="Loading this location" className="grid gap-4 xl:ml-[224px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-3 rounded-lg border border-line-soft bg-card p-5">
            <span className="skeleton block h-4 w-32 rounded" />
            <span className="skeleton block h-9 w-full rounded" />
            <span className="skeleton block h-9 w-2/3 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

function LocationForm({ loc: initialLoc, brand }: { loc: StudioLocationDto | null; brand: StudioLocationsResult["brand"] }) {
  const router = useRouter()
  const [loc, setLoc] = useState(initialLoc)
  const [f, setF] = useState<FormState>(() => initialFor(initialLoc, brand))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [enhancement, setEnhancement] = useState<Enhancement>("loading")
  const [active, setActive] = useState<string>("basics")
  const summaryRef = useRef<HTMLDivElement>(null)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }))
  const [savedImages, setSavedImages] = useState(() => new Set(initialLoc?.images.map((i) => i.mediaId) ?? []))
  const [openedAt] = useState(() => Date.now())
  const [pickZoom] = useState(() => (initialLoc && (initialLoc.neighbourhoodSlug || initialLoc.pinPrecision === "street") ? 14 : 12))

  const other = f.citySlug === OTHER
  const city = other ? null : cityBySlug(f.citySlug)
  const hood = city && f.hoodSlug && f.hoodSlug !== OTHER ? city.neighbourhoods.find((h) => h.slug === f.hoodSlug) : null
  const tz = other ? countryTimeZone[f.country] : (city?.timeZone ?? brand.timeZone)
  const tzLabel = `${other ? f.cityName.trim() || countryName(f.country) : (city?.name ?? brand.city)} time (${zoneShort(tz, openedAt)})`
  const dated = isDatedKind(f.kind)
  const brandProducts = useMemo(() => products.filter((p) => p.brandId === brand.id && p.status === "published"), [brand.id])
  const locked = !!loc?.locked

  // Section nav, as in Settings.
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el)
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: "-20% 0px -65% 0px" },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [loc?.id])

  function jump(id: string) {
    setActive(id)
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
  }

  // Changing the city or neighbourhood moves the pin to that area's centre (until it's placed by hand).
  function moveToArea(next: { citySlug?: string; hoodSlug?: string; country?: CountryCode }) {
    setF((x) => {
      const merged = { ...x, ...next }
      if (merged.citySlug === OTHER) {
        const first = cities.find((c) => c.country === merged.country) ?? cities[0]
        return { ...merged, lat: first.lat, lng: first.lng, latText: String(first.lat), lngText: String(first.lng), pinMoved: false, typed: false }
      }
      const c = cityBySlug(merged.citySlug)
      if (!c) return merged
      const h = merged.hoodSlug && merged.hoodSlug !== OTHER ? c.neighbourhoods.find((n) => n.slug === merged.hoodSlug) : null
      const at = h ?? c
      return { ...merged, country: c.country as CountryCode, lat: at.lat, lng: at.lng, latText: String(at.lat), lngText: String(at.lng), pinMoved: false, typed: false }
    })
  }

  const areaName = other ? (f.cityName.trim() || countryName(f.country)) : (hood?.name ?? city?.name ?? "")
  // Typed coordinates, or a pin dragged on the street map, are a precise spot. A pin nobody touched
  // in this edit keeps what was saved, so changing the description never downgrades a street pin.
  const untouched = !!loc && !f.typed && !f.pinMoved && f.lat === loc.lat && f.lng === loc.lng
  const pinPrecision: "street" | "area" = f.typed || (f.pinMoved && enhancement === "ready") ? "street" : untouched && loc ? loc.pinPrecision : "area"

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!f.name.trim()) e.name = "Name this place."
    if (!f.addressLine.trim()) e.addressLine = "Add the street address. Shoppers get directions from it."
    if (other) {
      if (!f.cityName.trim()) e.cityName = "Name the city."
      else if (cities.some((c) => c.name.toLowerCase() === f.cityName.trim().toLowerCase())) e.cityName = `${f.cityName.trim()} is on the list. Choose it under City.`
      if (!f.pinMoved && !f.typed) e.lat = `Move the pin onto your place in ${f.cityName.trim() || "the city"}, or type its coordinates.`
      else {
        const problem = otherCityPinProblem({ cityName: f.cityName, country: f.country, lat: f.lat, lng: f.lng })
        if (problem) e.lat = problem
      }
    } else if (city && haversineKm(f.lat, f.lng, city.lat, city.lng) > 60) e.lat = `That pin is outside ${city.name}. Move it or change the city.`
    // The typed text is what the merchant sees: an empty or unreadable field blocks Save rather
    // than quietly saving the last good pin.
    if (parseCoord(f.latText, -90, 90) === null || parseCoord(f.lngText, -180, 180) === null || !Number.isFinite(f.lat) || !Number.isFinite(f.lng)) e.lat = COORD_HELP
    if (dated) {
      if (!f.startDate) e.startsAt = `${kindLabel[f.kind]}s need a start date.`
      if (!f.endDate) e.endsAt = `${kindLabel[f.kind]}s need an end date.`
      if (f.startDate && f.endDate) {
        const start = zonedTimeToUtc(f.startDate, f.startTime, tz)
        const end = zonedTimeToUtc(f.endDate, f.endTime, tz)
        if (end <= start) e.endsAt = "The end has to come after the start."
        // The same range rules as the server, for dates that change (an old pop-up keeps its saved dates).
        const savedStart = loc?.startsAt ? Date.parse(loc.startsAt) : NaN
        const savedEnd = loc?.endsAt ? Date.parse(loc.endsAt) : NaN
        if (start !== savedStart || end !== savedEnd || loc?.kind !== f.kind) for (const [k, v] of Object.entries(dateRangeProblems(start, end, Date.now(), `${kindLabel[f.kind]}s`))) e[k] ??= v
      }
    }
    f.images.forEach((im, i) => {
      if (!im.alt.trim()) e[`images.${i}.alt`] = "Describe the photo for people who can't see it."
    })
    return e
  }

  const labelFor: Record<string, string> = { name: "Name", addressLine: "Address", cityName: "City name", citySlug: "City", lat: "Pin", startsAt: "Start", endsAt: "End", featuredProductIds: "Featured pieces", country: "Country" }
  function showErrors(e: Record<string, string>) {
    setErrors(e)
    const keys = Object.keys(e)
    setSummary(keys.map((k) => `${labelFor[k.split(".")[0]] ?? (k.startsWith("images") ? "Photos" : k.startsWith("hours") ? "Hours" : "A field")}: ${e[k]}`))
    requestAnimationFrame(() => summaryRef.current?.focus())
  }

  async function save(nextVisibility?: Visibility) {
    const vis = nextVisibility ?? f.visibility
    const e = validate()
    if (Object.keys(e).length) return showErrors(e)
    setErrors({})
    setSummary([])
    const body: LocationWriteBody = {
      kind: f.kind,
      name: f.name.trim(),
      description: f.description.trim() || null,
      inGazetteer: !other,
      citySlug: other ? null : f.citySlug,
      neighbourhoodSlug: !other && hood ? hood.slug : null,
      neighbourhoodName: other || f.hoodSlug === OTHER ? f.hoodName.trim() || null : null,
      cityName: other ? f.cityName.trim() : null,
      country: other ? f.country : null,
      addressLine: f.addressLine.trim(),
      lat: r6(f.lat),
      lng: r6(f.lng),
      pinPrecision,
      hours: dated || (f.byAppointment && !f.hours) ? null : f.hours,
      byAppointment: !dated && f.byAppointment,
      hoursNote: f.hoursNote.trim() || null,
      startsAt: dated ? new Date(zonedTimeToUtc(f.startDate, f.startTime, tz)).toISOString() : null,
      endsAt: dated ? new Date(zonedTimeToUtc(f.endDate, f.endTime, tz)).toISOString() : null,
      images: f.images.map((i) => ({ mediaId: i.mediaId, alt: i.alt.trim() })),
      featuredProductIds: f.featured,
      visibility: vis,
    }
    setSaving(true)
    try {
      const r = loc ? await updateStudioLocation(loc.id, body) : await createStudioLocation(body)
      setLoc(r.location)
      setSavedImages(new Set(r.location.images.map((i) => i.mediaId)))
      setF((x) => ({ ...x, visibility: r.location.visibility, pinMoved: false, typed: false, lat: r.location.lat, lng: r.location.lng }))
      revalidatePrefix(STUDIO_LOCATIONS_KEY)
      toast.success(r.outcome ? outcomeCopy[r.outcome] : "Saved.", r.outcome === "submitted" || r.outcome === "resubmitted" ? { description: "It isn't public until Yard approves it. Its photos stay private until then." } : undefined)
      if (!loc) router.replace(`/studio/locations/edit?id=${encodeURIComponent(r.location.id)}`)
    } catch (err) {
      const fe = fieldErrors(err)
      if (Object.keys(fe).length) showErrors(fe)
      else toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const status = loc ? placeStatusMeta[loc.status] : null
  return (
    <div className="grid gap-6">
      <PageHeader
        title={loc ? loc.name : "Add location"}
        description={loc ? `${kindLabel[loc.kind]} in ${[loc.neighbourhood, loc.city].filter(Boolean).join(", ")}` : "A store, showroom, pop-up or exhibition shoppers can visit."}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/studio/locations">
                <ArrowLeftIcon /> Locations
              </Link>
            </Button>
            <Button type="button" variant="primary" size="sm" loading={saving} disabled={locked} onClick={() => void save()}>
              {loc ? "Save" : f.visibility === "published" ? "Save and publish" : "Save"}
            </Button>
          </>
        }
      >
        {status || loc?.sample ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
            {loc?.sample ? <SampleChip label="Sample place" /> : null}
          </div>
        ) : null}
      </PageHeader>

      {locked ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-ink">
          <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          {loc!.status === "removed" ? "Yard removed this place. You can delete it from Locations." : `Yard rejected this place${loc!.moderationReason ? `: ${loc!.moderationReason}` : ""}. Duplicate it from Locations to submit a corrected version.`}
        </p>
      ) : null}

      {summary.length ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 outline-none">
          <p className="text-sm text-ink">Check {summary.length === 1 ? "this" : `these ${summary.length}`} before saving:</p>
          <ul className="mt-1.5 grid gap-0.5 text-xs text-danger">
            {summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <nav aria-label="Location sections" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] xl:hidden">
        <ul className="flex min-w-max gap-1.5">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault()
                  jump(s.id)
                }}
                aria-current={active === s.id ? "true" : undefined}
                className={cn("inline-flex h-10 items-center rounded-full border px-3 text-xs transition-colors md:h-8", active === s.id ? "border-purple bg-purple/20 text-ink" : "border-line text-ink-2 hover:text-ink")}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid items-start gap-6 xl:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Location sections" className="sticky top-24 hidden xl:block">
          <ul className="grid gap-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    jump(s.id)
                  }}
                  aria-current={active === s.id ? "true" : undefined}
                  className={cn("relative flex h-9 items-center rounded-md px-3 text-sm transition-colors", active === s.id ? "text-ink" : "text-ink-2 hover:text-ink")}
                >
                  {active === s.id ? <motion.span layoutId="locations-nav" aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-purple" transition={spring.indicator} /> : null}
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <fieldset disabled={locked} className="grid min-w-0 gap-6">
          <Panel id="basics" title="Basics">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <p id="loc-kind-label" className="text-[13px] text-ink">
                  Kind
                </p>
                <Segmented
                  id="loc-kind"
                  label="Kind"
                  labelledBy="loc-kind-label"
                  value={f.kind}
                  onChange={(v) => set("kind", v)}
                  options={(["store", "showroom", "popup", "exhibition"] as const).map((k) => ({ value: k, label: kindLabel[k] }))}
                />
              </div>
              <Field id="loc-name" label="Name" error={errors.name} hint="Shoppers see it with your brand name, e.g. Lagos Static Yaba.">
                <Input {...control("loc-name", errors.name, true)} value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} className={inputClass} />
              </Field>
              <Field id="loc-description" label="Description" optional error={errors.description}>
                <Textarea id="loc-description" value={f.description} maxLength={600} rows={3} onChange={(e) => set("description", e.target.value)} />
              </Field>
            </div>
          </Panel>

          <Panel id="map" title="On the map" description="Where shoppers find you. Yard Around shows the pin and your address line.">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field id="loc-citySlug" label="City" error={errors.citySlug} hint="Yard Around search covers these cities for now. Elsewhere, choose Other city.">
                  <Select value={f.citySlug} onValueChange={(v) => moveToArea({ citySlug: v, hoodSlug: "" })}>
                    <SelectTrigger id="loc-citySlug" className={selectClass} aria-describedby="loc-citySlug-hint">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {cities.map((c) => (
                        <SelectItem key={c.slug} value={c.slug}>
                          {c.name}, {countryName(c.country)}
                        </SelectItem>
                      ))}
                      <SelectItem value={OTHER}>Other city</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {other ? (
                  <Field id="loc-country" label="Country" error={errors.country}>
                    <Select value={f.country} onValueChange={(v) => moveToArea({ country: v as CountryCode })}>
                      <SelectTrigger id="loc-country" className={selectClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {MARKET_COUNTRIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {countryName(c)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : (
                  <Field id="loc-neighbourhoodSlug" label="Neighbourhood" optional error={errors.neighbourhoodSlug}>
                    <Select value={f.hoodSlug || "none"} onValueChange={(v) => (v === OTHER ? set("hoodSlug", OTHER) : moveToArea({ hoodSlug: v === "none" ? "" : v }))}>
                      <SelectTrigger id="loc-neighbourhoodSlug" className={selectClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="none">Not set</SelectItem>
                        {city?.neighbourhoods.map((h) => (
                          <SelectItem key={h.slug} value={h.slug}>
                            {h.name}
                          </SelectItem>
                        ))}
                        <SelectItem value={OTHER}>Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                {other ? (
                  <Field id="loc-cityName" label="City name" error={errors.cityName} hint="It shows on the map and in lists. Area search won't find this city until Yard adds it.">
                    <Input {...control("loc-cityName", errors.cityName, true)} value={f.cityName} maxLength={60} onChange={(e) => set("cityName", e.target.value)} className={inputClass} />
                  </Field>
                ) : null}
                {other || f.hoodSlug === OTHER ? (
                  <Field id="loc-hoodName" label="Neighbourhood" optional>
                    <Input id="loc-hoodName" value={f.hoodName} maxLength={60} onChange={(e) => set("hoodName", e.target.value)} className={inputClass} />
                  </Field>
                ) : null}
              </div>
              <Field id="loc-addressLine" label="Address line" error={errors.addressLine}>
                <Input {...control("loc-addressLine", errors.addressLine)} value={f.addressLine} maxLength={140} onChange={(e) => set("addressLine", e.target.value)} className={inputClass} autoComplete="street-address" />
              </Field>
              <PickMap
                // A bare city opens at 12, so its neighbourhood rings and names show around the pin.
                zoom={pickZoom}
                lat={f.lat}
                lng={f.lng}
                latText={f.latText}
                lngText={f.lngText}
                areaName={areaName}
                enhancement={enhancement}
                onEnhancement={setEnhancement}
                error={errors.lat ?? errors.lng}
                onPin={(p) => setF((x) => ({ ...x, lat: p.lat, lng: p.lng, latText: String(p.lat), lngText: String(p.lng), pinMoved: true }))}
                onTyped={(field, text) =>
                  setF((x) => {
                    const latText = field === "lat" ? text : x.latText
                    const lngText = field === "lng" ? text : x.lngText
                    const la = parseCoord(latText, -90, 90)
                    const ln = parseCoord(lngText, -180, 180)
                    // The pin follows the fields only once both read as coordinates; until then
                    // nothing counts as typed, and Save says what's wrong.
                    return la !== null && ln !== null ? { ...x, latText, lngText, lat: la, lng: ln, typed: true } : { ...x, latText, lngText, typed: false }
                  })
                }
              />
              <p className="text-xs text-ink-3">{pinPrecision === "street" ? "This pin is saved as your exact spot: Directions use its coordinates." : "This pin is saved as an area: Directions search your address line."}</p>
            </div>
          </Panel>

          <Panel id="hours" title={dated ? "Dates" : "Hours"} description={dated ? `Start and end in ${tzLabel}.` : undefined}>
            {dated ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Field id="loc-startsAt" label="Starts" error={errors.startsAt}>
                  <Input {...control("loc-startsAt", errors.startsAt)} type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} className={inputClass} />
                </Field>
                <Field id="loc-start-time" label="At">
                  <Input id="loc-start-time" type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} className={inputClass} />
                </Field>
                <Field id="loc-endsAt" label="Ends" error={errors.endsAt}>
                  <Input {...control("loc-endsAt", errors.endsAt)} type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} className={inputClass} />
                </Field>
                <Field id="loc-end-time" label="At">
                  <Input id="loc-end-time" type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} className={inputClass} />
                </Field>
              </div>
            ) : (
              <div className="grid gap-4">
                <HoursEditor id="loc-hours" value={f.hours} onChange={(h) => set("hours", h)} errors={errors} zoneLabel={tzLabel} />
                <label htmlFor="loc-appointment" className="flex min-h-10 items-center justify-between gap-3 text-sm text-ink">
                  By appointment only
                  <Switch id="loc-appointment" checked={f.byAppointment} onCheckedChange={(v) => set("byAppointment", v)} />
                </label>
                <Field id="loc-hoursNote" label="Note" optional hint="For example: Fittings by appointment, Tuesday to Saturday.">
                  <Input id="loc-hoursNote" value={f.hoursNote} maxLength={120} onChange={(e) => set("hoursNote", e.target.value)} className={inputClass} />
                </Field>
              </div>
            )}
          </Panel>

          <Panel id="photos" title="Photos" description="Up to 6. The first is the cover. They stay private until the place is published and approved.">
            <div className="grid gap-3">
              <PhotoList items={f.images} onChange={(items) => set("images", items)} errors={errors} />
              {f.images.length < 6 ? (
                <MediaUploader
                  purpose="location_image"
                  as="brand"
                  maxFiles={6 - f.images.filter((i) => savedImages.has(i.mediaId)).length}
                  disabled={locked}
                  onUploaded={(m) => setF((x) => (x.images.some((i) => i.mediaId === m.id) || x.images.length >= 6 ? x : { ...x, images: [...x.images, { mediaId: m.id, src: m.src, alt: "" }] }))}
                  onRemoved={(m) => setF((x) => ({ ...x, images: x.images.filter((i) => i.mediaId !== m.id) }))}
                />
              ) : (
                <p className="text-xs text-ink-3">That&apos;s 6 photos, the most a place can have. Remove one to add another.</p>
              )}
            </div>
          </Panel>

          <Panel id="featured" title="Featured pieces" description="Shown on the place's page on Around.">
            <ProductPicker id="loc-featured" legend="Pieces" max={8} products={brandProducts} value={f.featured} onChange={(v) => set("featured", v)} error={errors["featuredProductIds.0"]} />
          </Panel>

          {loc ? (
            <EventsSection loc={loc} brandId={brand.id} onChanged={(l) => setLoc(l)} disabled={locked} />
          ) : (
            <Panel id="events" title="Events" description="Save the place first, then add launches, talks and sales here.">
              {null}
            </Panel>
          )}

          <Panel id="visibility" title="Visibility" description={brand.verified ? "Published places show on Around within a minute." : `${brand.name} isn't verified yet, so Yard reviews a place before it's public.`}>
            <div className="grid gap-3">
              <Segmented
                id="loc-visibility"
                label="Visibility"
                value={f.visibility}
                onChange={(v) => set("visibility", v)}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "published", label: "Published" },
                  { value: "hidden", label: "Hidden" },
                ]}
              />
              <p className="text-xs text-ink-2">
                {f.visibility === "published" ? "Shoppers can find it on Yard Around." : f.visibility === "hidden" ? "Off Around, kept for later." : "Only your team can see it."}
              </p>
              <div className="flex justify-end">
                <Button type="button" variant="primary" loading={saving} disabled={locked} onClick={() => void save()}>
                  {f.visibility === "published" ? (loc?.visibility === "published" ? "Save" : "Save and publish") : "Save"}
                </Button>
              </div>
            </div>
          </Panel>
        </fieldset>
      </div>
    </div>
  )
}
