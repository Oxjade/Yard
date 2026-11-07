"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeftIcon, ArrowUpRightIcon, CalendarBlankIcon, DotsThreeIcon, FlagIcon, LinkSimpleIcon, SealCheckIcon, TagIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import type { PlaceDetailDto, PlaceEventDto, PlaceSummaryDto } from "@/lib/api/contracts/around"
import { formatDistance } from "@/lib/around/geo"
import { DAYS, dateRange, dayLabels, dayTimeIn, localClock, openState, rangesLabel, sameClock, zoneShort } from "@/lib/around/hours"
import { canonicalPlacePath, eventKindLabel, isDatedKind, safePlaceSrc } from "@/lib/around/labels"
import { brandById } from "@/lib/data/brands"
import { productById } from "@/lib/data/products"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import { ProductCard } from "@/components/market/product-card"
import { ReportSheet } from "@/components/report/report-sheet"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SampleChip } from "@/components/ui/sample-chip"
import { cn } from "@/lib/utils"
import { CategoryKind, StatusText } from "./place-card"

/**
 * PlaceDetail (§6.4): what a shopper needs to decide to go. Used in the desktop panel (with a back
 * arrow) and inside the phone PlaceSheet. Visit storefront is the one acid action; Directions open
 * OpenStreetMap (by coordinates only for street-precision pins, by the address text otherwise) and
 * sample places say they aren't real instead.
 */

export function directionsHref(p: Pick<PlaceDetailDto, "pinPrecision" | "lat" | "lng" | "addressLine" | "neighbourhood" | "city" | "country">) {
  if (p.pinPrecision === "street") return `https://www.openstreetmap.org/directions?to=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
  const q = [p.addressLine, p.neighbourhood, p.city, countryLabel(p.country)].filter(Boolean).join(", ")
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`
}

const countryNames: Record<string, string> = { NG: "Nigeria", GH: "Ghana", KE: "Kenya", ZA: "South Africa", GB: "United Kingdom", FR: "France", DE: "Germany", US: "United States", MX: "Mexico", JP: "Japan", KR: "South Korea" }
const countryLabel = (c: string) => countryNames[c] ?? c


export async function sharePlace(id: string) {
  const url = `${window.location.origin}${canonicalPlacePath(id)}`
  try {
    await navigator.clipboard.writeText(url)
    toast("Link copied", { description: "It opens this place on Yard Around. It doesn't include your area or filters." })
  } catch {
    toast.error(`Couldn't reach the clipboard. Copy this link by hand: ${url}`)
  }
}

type Props = {
  summary?: PlaceSummaryDto | null
  detail?: PlaceDetailDto | null
  loading: boolean
  error: unknown
  onRetry: () => void
  onBack?: () => void
  now: number
  distance?: { km: number; from: string } | null
  className?: string
}

function DetailError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const gone = (error as { status?: number } | null)?.status === 404
  return (
    <div role="alert" className="grid gap-3 rounded-xl border border-white/10 p-4">
      <p className="text-sm text-ink">{gone ? "This place isn't on Yard Around any more. It may have ended or been taken down." : "Couldn't load this place."}</p>
      {gone ? null : (
        <Button size="sm" variant="secondary" onClick={onRetry} className="justify-self-start">
          Retry
        </Button>
      )}
    </div>
  )
}

export function PlaceDetail({ summary, detail, loading, error, onRetry, onBack, now, distance, className }: Props) {
  const p = detail ?? summary ?? null
  const [report, setReport] = useState<{ type: "location" | "location_event"; id: string; label: string } | null>(null)
  const [lastReport, setLastReport] = useState(report)
  if (report && report !== lastReport) setLastReport(report)
  const shown = report ?? lastReport

  if (!p) {
    return (
      <div className={cn("grid gap-4 p-4", className)}>
        {onBack ? <BackButton onBack={onBack} /> : null}
        {error ? <DetailError error={error} onRetry={onRetry} /> : <DetailSkeleton />}
      </div>
    )
  }

  const brand = brandById.get(p.brand.id)
  const photos = (detail?.images.length ? detail.images : p.image ? [p.image] : []).map((im) => ({ ...im, src: safePlaceSrc(im.src) })).filter((im) => im.src)
  const cover = brand?.cover
  const where = [p.neighbourhood, p.city, countryLabel(p.country)].filter(Boolean).join(", ")

  return (
    // Brand-written text can hold long unbroken tokens: overflow-wrap (inherited) lets every line
    // break anywhere, and minmax(0, 1fr) tracks keep the sheet from growing past the screen.
    <article className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5 [overflow-wrap:anywhere]", className)} aria-label={`${p.brand.name}, ${p.name}`}>
      {onBack ? <BackButton onBack={onBack} className="mx-4 mt-3" /> : null}

      {/* Photos, 4:3; the brand's cover when the place has none. */}
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {(photos.length ? photos : cover ? [{ src: cover.src, alt: `${p.brand.name}`, width: cover.width, height: cover.height }] : []).map((im, i) => (
          <div key={`${im.src}-${i}`} className={cn("relative aspect-[4/3] shrink-0 snap-start overflow-hidden rounded-xl bg-card", photos.length > 1 ? "w-[85%]" : "w-full")}>
            {/* Stored media can be private (brand preview) or public: a plain img keeps cookies and never goes through the optimizer. */}
            {im.src!.startsWith("/api/media/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={im.src!} alt={im.alt} className="absolute inset-0 size-full object-cover" loading="lazy" />
            ) : (
              <Image src={im.src!} alt={im.alt} fill sizes="(min-width: 1024px) 380px, 90vw" className="object-cover" />
            )}
            {!photos.length ? <span className="absolute bottom-2 left-2 rounded-full bg-obsidian/70 px-2 py-0.5 text-[10px] text-ink-2">Brand photo</span> : null}
          </div>
        ))}
      </div>

      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 px-4">
        <div className="flex items-center gap-3">
          <BrandMark brand={p.brand} size="md" className="rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[0.9375rem] font-medium text-ink">
              <Link href={`/brands/${p.brand.handle}`} className="truncate hover:underline">
                {p.brand.name}
              </Link>
              {p.brand.verified ? <SealCheckIcon weight="fill" className="size-4 shrink-0 text-violet" aria-label="Verified brand" /> : null}
            </p>
            <p className="truncate text-xs text-ink-2">{p.name}</p>
          </div>
          <FollowButton brandId={p.brand.id} brandName={p.brand.name} size="sm" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-6 items-center rounded-full border border-white/10 px-2.5 text-xs text-ink">
            <CategoryKind place={p} />
          </span>
          {p.sample ? <SampleChip label="Sample place" /> : null}
        </div>
        <div className="grid min-w-0 gap-1 text-sm">
          {detail ? <p className="text-ink">{detail.addressLine}</p> : null}
          <p className="text-ink-2">{where}</p>
          {distance ? <p className="text-xs text-ink-2 tabular">{formatDistance(distance.km)} from {distance.from}</p> : null}
          <StatusText place={p} now={now} className="text-xs text-ink-2" />
        </div>
        {detail?.description ? <p className="min-w-0 text-sm leading-relaxed whitespace-pre-line text-ink-2">{detail.description}</p> : null}
      </header>

      {/* Actions: one acid. */}
      <div className="grid gap-2 px-4">
        <div className="flex items-center gap-2">
          <Button asChild variant="primary" className="flex-1">
            <Link href={`/brands/${p.brand.handle}`}>Visit storefront</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="More for this place">
                <DotsThreeIcon weight="bold" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={() => void sharePlace(p.id)}>
                <LinkSimpleIcon /> Share
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setReport({ type: "location", id: p.id, label: "place" })}>
                <FlagIcon /> Report this place
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {p.sample ? (
          <p className="text-xs text-ink-2">Sample location — not a real address.</p>
        ) : detail ? (
          <Button asChild variant="secondary">
            <a href={directionsHref(detail)} target="_blank" rel="noopener noreferrer" aria-label="Directions, opens OpenStreetMap in a new tab">
              Directions <ArrowUpRightIcon />
              <span className="text-xs font-normal text-ink-2">Opens OpenStreetMap</span>
            </a>
          </Button>
        ) : null}
      </div>

      {detail ? (
        <>
          {isDatedKind(p.kind) && p.startsAt && p.endsAt ? <Dates place={detail} /> : <Hours place={detail} now={now} />}
          <Happening place={detail} now={now} onReport={(e) => setReport({ type: "location_event", id: e.id, label: "event" })} />
          <Featured place={detail} />
        </>
      ) : error ? (
        // The summary is known but the details failed: say so, never keep a skeleton spinning.
        <div className="px-4">
          <DetailError error={error} onRetry={onRetry} />
        </div>
      ) : loading ? (
        <div className="px-4">
          <DetailSkeleton compact />
        </div>
      ) : null}

      {shown ? <ReportSheet open={!!report} onOpenChange={(o) => !o && setReport(null)} subjectType={shown.type} subjectId={shown.id} as="shopper" subjectLabel={shown.label} /> : null}
    </article>
  )
}

function BackButton({ onBack, className }: { onBack: () => void; className?: string }) {
  return (
    <button type="button" onClick={onBack} className={cn("inline-flex h-10 items-center gap-1.5 justify-self-start rounded-lg pr-3 pl-1.5 text-sm text-ink-2 hover:text-ink", className)}>
      <ArrowLeftIcon className="size-4" aria-hidden /> All places
    </button>
  )
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5 px-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-medium text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Hours({ place, now }: { place: PlaceDetailDto; now: number }) {
  const viewerTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : place.timeZone
  const differs = !sameClock(place.timeZone, viewerTz, now)
  const today = localClock(now, place.timeZone).day
  const state = openState(place.hours, place.timeZone, now)
  if (!place.hours && !place.byAppointment) return null
  return (
    <Section title="Opening hours" aside={differs ? <span className="text-xs text-ink-2">{place.city} time ({zoneShort(place.timeZone, now)})</span> : null}>
      {state ? <p className={cn("text-xs", state.open ? "text-ink" : "text-ink-2")}>{state.open ? `Open now, closes ${state.closes}` : state.opens ? `Closed now, opens ${state.opens.today ? "" : state.opens.tomorrow ? "tomorrow " : `${dayLabels[state.opens.day]} `}${state.opens.time}` : "Closed now"}</p> : null}
      {place.hours ? (
        <table className="w-full text-sm">
          <caption className="sr-only">Opening hours, {place.city} time</caption>
          <tbody>
            {DAYS.map((d) => (
              <tr key={d} className={cn("border-b border-white/[0.06] last:border-0", d === today ? "font-medium text-ink" : "text-ink-2")}>
                <th scope="row" className="py-1.5 pr-3 text-left font-[inherit]">
                  {dayLabels[d]}
                  {d === today ? <span className="sr-only"> (today)</span> : null}
                </th>
                <td className="py-1.5 text-right tabular">{rangesLabel(place.hours?.[d])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {place.byAppointment ? <p className="text-xs text-ink-2">By appointment{place.hoursNote ? `. ${place.hoursNote}` : ""}</p> : place.hoursNote ? <p className="text-xs text-ink-2">{place.hoursNote}</p> : null}
    </Section>
  )
}

function Dates({ place }: { place: PlaceDetailDto }) {
  return (
    <Section title="Dates" aside={<span className="text-xs text-ink-2">{place.city} time ({zoneShort(place.timeZone, Date.parse(place.startsAt!))})</span>}>
      <p className="text-sm text-ink">{dateRange(place.startsAt!, place.endsAt!, place.timeZone)}</p>
      <p className="text-xs text-ink-2 tabular">
        From {dayTimeIn(place.startsAt!, place.timeZone)} to {dayTimeIn(place.endsAt!, place.timeZone)}
      </p>
    </Section>
  )
}

function Happening({ place, now, onReport }: { place: PlaceDetailDto; now: number; onReport: (e: PlaceEventDto) => void }) {
  if (!place.events.length) return null
  return (
    <Section title="Happening here">
      <ul className="grid gap-2">
        {place.events.map((e) => {
          const live = Date.parse(e.startsAt) <= now
          return (
            <li key={e.id} className="flex items-start gap-3 rounded-xl border border-white/[0.08] p-3">
              <CalendarBlankIcon className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
              <div className="grid min-w-0 flex-1 gap-1">
                <p className="text-sm text-ink">{e.title}</p>
                <p className="flex items-center gap-1.5 text-xs text-ink-2">
                  {live ? <span aria-hidden className="size-1.5 rounded-full bg-acid" /> : null}
                  {live ? "On now, until " : ""}
                  {live ? dayTimeIn(e.endsAt, place.timeZone) : dateRange(e.startsAt, e.endsAt, place.timeZone)}
                  <span className="sr-only">, {eventKindLabel[e.kind]}</span>
                </p>
                {e.promoText ? (
                  <p className="flex items-center gap-1.5 text-xs text-ink">
                    <TagIcon className="size-3.5 text-violet" aria-hidden /> {e.promoText}
                  </p>
                ) : null}
                {e.drop ? (
                  <Link href={`/drops/${e.drop.slug}`} className="justify-self-start text-xs text-violet hover:underline">
                    See {e.drop.name}
                  </Link>
                ) : null}
                {e.sample ? <SampleChip className="justify-self-start" /> : null}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`More for ${e.title}`}>
                    <DotsThreeIcon weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onReport(e)}>
                    <FlagIcon /> Report this event
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function Featured({ place }: { place: PlaceDetailDto }) {
  const items = place.featured.map((f) => productById.get(f.id)).filter((x): x is NonNullable<typeof x> => !!x)
  if (!items.length) return null
  return (
    <Section title="Featured pieces">
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {items.map((pr) => (
          <ProductCard key={pr.id} product={pr} variant="compact" sizes="160px" className="w-36 shrink-0 snap-start" />
        ))}
      </div>
    </Section>
  )
}

export function DetailSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div role="status" aria-label="Loading this place" className="grid gap-3">
      {compact ? null : <span className="skeleton block aspect-[4/3] w-full rounded-xl" />}
      <span className="skeleton block h-4 w-2/3 rounded" />
      <span className="skeleton block h-3 w-1/2 rounded" />
      <span className="skeleton block h-24 w-full rounded-xl" />
    </div>
  )
}
