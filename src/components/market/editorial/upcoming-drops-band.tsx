"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowCounterClockwiseIcon as RetryIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { api } from "@/lib/api/client"
import { brandHref } from "@/lib/api/catalog-products"
import { dropAccessForButton, dropActionMode, dropImageSrc, dropPhaseAt, isApiImage, type PublicDropDto } from "@/lib/api/drops"
import { pluralize } from "@/lib/utils"
import { useApi } from "@/lib/api/use-api"
import { NotifyButton } from "@/components/market/notify-button"
import { Rail } from "@/components/market/rail"
import { SponsoredTag } from "@/components/market/sponsored-tag"

const DROPS_KEY = "/api/drops?phase=upcoming&limit=8"
type DropPage = { items: PublicDropDto[]; nextCursor: string | null }
const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const utcDate = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })
const getUpcoming = () => api<DropPage>(DROPS_KEY, { cache: "default" })

function displayTime(value: string, hydrated: boolean) {
  return (hydrated ? localDate : utcDate).format(new Date(value))
}

function accessLabel(drop: PublicDropDto) {
  return drop.access === "draw" ? "Draw" : drop.access === "early_access" ? "Early access" : "First come"
}

/** Before release: a reminder, or the draw entry once entries are open (a draw takes no entries before). */
function releaseAction(drop: PublicDropDto, now: number | null) {
  const mode = dropActionMode(drop, dropPhaseAt(drop, now))
  if (!mode) return <Button asChild size="sm" variant="glass"><Link href={`/drops/${drop.slug}`}>View drop</Link></Button>
  return <NotifyButton drop={{ id: drop.id, access: dropAccessForButton(drop.access) }} mode={mode} size="sm" variant="glass" quiet />
}

/** When the drop's next moment is: entries opening for a draw that isn't open yet, else the release. */
function nextMoment(drop: PublicDropDto, now: number | null, hydrated: boolean) {
  const phase = dropPhaseAt(drop, now)
  if (drop.access === "draw" && phase === "upcoming" && drop.entryOpensAt) return `Entries open ${displayTime(drop.entryOpensAt, hydrated)}`
  if (phase === "entries_open") return `Entries close ${displayTime(drop.entryClosesAt ?? drop.startsAt, hydrated)}`
  return `Releases ${displayTime(drop.startsAt, hydrated)}`
}

const statusOf = (drop: PublicDropDto, now: number | null) => {
  const phase = dropPhaseAt(drop, now)
  return phase === "entries_open" ? "Entries open" : phase === "early_access" ? "Early access" : accessLabel(drop)
}

/** Discover's live upcoming-drops band (production; demo shows SampleUpcomingDropsBand). Times are API instants and render in the shopper's zone. */
export function UpcomingDropsBand() {
  const hydrated = useHydrated()
  const now = useNow(30_000)
  const { data, error, isLoading, isValidating, revalidate } = useApi(DROPS_KEY, getUpcoming, { revalidateOnFocus: false })
  const [lead, ...rest] = data?.items ?? []

  return (
    <section aria-labelledby="drops-title" className="relative mt-4 overflow-hidden bg-purple">
      <div className="mx-auto grid max-w-page gap-10 px-4 py-14 md:px-8 md:py-20 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-x-16">
        <div className="flex min-w-0 flex-col">
          <h2 id="drops-title" className="font-display text-display-lg text-ink">Upcoming drops</h2>
          <p className="mt-3 max-w-sm text-[0.9375rem] leading-relaxed text-ink/80">
            Limited releases on a schedule. Set a reminder and we&apos;ll tell you the moment one goes live.
          </p>
          {isLoading && !data ? <LeadSkeleton /> : error && !data ? (
            <div role="alert" className="mt-10 rounded-lg border border-white/15 bg-obsidian/25 p-5 text-sm text-ink/85">
              <p>Upcoming drops couldn&apos;t be loaded.</p>
              <Button variant="glass" size="sm" className="mt-3" loading={isValidating} onClick={() => void revalidate()}><RetryIcon /> Retry</Button>
            </div>
          ) : lead ? <LeadDrop drop={lead} hydrated={hydrated} now={now} /> : (
            <p className="mt-10 rounded-lg border border-white/15 bg-obsidian/25 p-5 text-sm leading-relaxed text-ink/80">
              No release is scheduled right now. Past drops keep their pages on the drops calendar.
            </p>
          )}
        </div>
        <div className="min-w-0 lg:pt-16">
          {rest.length ? (
            <Rail label="More upcoming drops" marquee itemClassName="sm:w-[46vw] md:w-[34vw] lg:w-[48cqw]" footer={<Link href="/drops" className="inline-flex py-2.5 text-sm text-ink underline-offset-4 hover:underline">See the full drop calendar</Link>}>
              {rest.map((drop) => <RailDrop key={drop.id} drop={drop} hydrated={hydrated} now={now} />)}
            </Rail>
          ) : (
            <Link href="/drops" className="mt-6 inline-flex min-h-10 items-center text-sm text-ink underline-offset-4 hover:underline">See the full drop calendar</Link>
          )}
        </div>
      </div>
    </section>
  )
}

function LeadSkeleton() {
  return <div role="status" aria-label="Loading upcoming drops" className="mt-10 grid gap-3 rounded-lg border border-white/15 bg-obsidian/25 p-5">
    <Bone className="aspect-[4/3] w-full rounded-md" />
    <Bone className="h-4 w-24" />
    <Bone className="h-6 w-3/4" />
    <Bone className="h-4 w-40" />
  </div>
}

function LeadDrop({ drop, hydrated, now }: { drop: PublicDropDto; hydrated: boolean; now: number | null }) {
  const brandName = drop.brand.name ?? "Independent brand"
  const src = dropImageSrc(drop.image)
  return <article className="mt-10 grid min-w-0 gap-4 rounded-lg border border-white/15 bg-obsidian/25 p-4 backdrop-blur-sm sm:p-5">
    <Link href={`/drops/${drop.slug}`} className="group relative block aspect-[4/3] overflow-hidden rounded-md">
      <Image src={src} alt={drop.name} fill unoptimized={isApiImage(src)} sizes="(min-width: 1024px) 390px, 90vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
      {drop.sponsored ? <span className="absolute top-3 left-3"><SponsoredTag /></span> : null}
    </Link>
    <div className="flex min-w-0 items-center justify-between gap-3">
      {drop.brand.handle ? <Link href={brandHref(drop.brand.handle)} className="truncate text-sm text-ink/80 hover:text-ink">{brandName}</Link> : <span className="truncate text-sm text-ink/80">{brandName}</span>}
      <span className="shrink-0 rounded-sm bg-elevated px-2 py-1 text-[10px] text-ink">{statusOf(drop, now)}</span>
    </div>
    <Link href={`/drops/${drop.slug}`} className="font-display text-display-sm text-ink">{drop.name}</Link>
    <p className="text-xs text-ink/70">{nextMoment(drop, now, hydrated)}{hydrated ? " · your time" : ""}</p>
    <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-4">
      <span className="text-xs text-ink/70">{pluralize(drop.totalUnits, "piece")} · limit {drop.limitPerCustomer}</span>
      {releaseAction(drop, now)}
    </div>
  </article>
}

function RailDrop({ drop, hydrated, now }: { drop: PublicDropDto; hydrated: boolean; now: number | null }) {
  const brandName = drop.brand.name ?? "Independent brand"
  const src = dropImageSrc(drop.image)
  return <article className="group/drop relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-obsidian/70">
    <Link href={`/drops/${drop.slug}`} className="relative block aspect-[4/3] overflow-hidden">
      <Image src={src} alt={drop.name} fill unoptimized={isApiImage(src)} sizes="(min-width: 1024px) 420px, 80vw" className="object-cover transition-transform duration-700 group-hover/drop:scale-[1.03]" />
    </Link>
    <div className="flex flex-1 flex-col gap-3 p-4">
      {drop.brand.handle ? <Link href={brandHref(drop.brand.handle)} className="truncate text-xs text-ink/70 hover:text-ink">{brandName}</Link> : <span className="truncate text-xs text-ink/70">{brandName}</span>}
      <Link href={`/drops/${drop.slug}`} className="font-display text-display-sm text-ink">{drop.name}</Link>
      <p className="text-xs text-ink/70">{statusOf(drop, now)} · {nextMoment(drop, now, hydrated)}{hydrated ? " · your time" : ""}</p>
      <div className="mt-auto flex justify-end border-t border-white/10 pt-3">{releaseAction(drop, now)}</div>
    </div>
  </article>
}