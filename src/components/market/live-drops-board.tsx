"use client"

import { useCallback, useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon as ArrowRight, CalendarDotsIcon as CalendarClock } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { brandHref } from "@/lib/api/catalog-products"
import { dropAccessForButton, dropActionMode, dropImageSrc, dropPhaseAt, isApiImage, type DropPhaseDto, type PublicDropDto } from "@/lib/api/drops"
import { cn, pluralize } from "@/lib/utils"
import { NotifyButton } from "./notify-button"
import { SectionHeader } from "./section-header"

type DropPage = { items: PublicDropDto[]; nextCursor: string | null }
type Source = "live" | "upcoming" | "ended"
type Feed = { items: PublicDropDto[]; cursor: string | null; loadingMore: boolean; moreError: string | null }
type GroupId = "live" | "entries-open" | "upcoming" | "past"
type Group = { id: GroupId; title: string; description: string; drops: PublicDropDto[]; more: Source | null }

const PAGE_SIZE = 24
const SOURCES: Source[] = ["live", "upcoming", "ended"]
const utcDate = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })
const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const emptyFeed = (): Feed => ({ items: [], cursor: null, loadingMore: false, moreError: null })

function accessLabel(access: PublicDropDto["access"]) {
  return access === "draw" ? "Draw" : access === "early_access" ? "Early access" : "First come"
}

function displayTime(value: string, hydrated: boolean) {
  return (hydrated ? localDate : utcDate).format(new Date(value))
}

/** A released draw: its window belongs to the drawn winners, so it reads as results, not "Shop". */
const isWinnersWindow = (drop: PublicDropDto, phase: DropPhaseDto) => phase === "live" && drop.access === "draw"

function groupOf(drop: PublicDropDto, phase: DropPhaseDto): GroupId {
  if (phase === "ended") return "past"
  if (phase === "entries_open") return "entries-open"
  if (phase === "upcoming" || phase === "early_access") return "upcoming"
  return "live"
}

/**
 * The /drops calendar. Live, upcoming and past drops are read as three separate pages (each
 * with its own "Load more"), so what's on now never waits behind a long history of past drops.
 * Phases are recomputed on the shopper's clock, so a drop moves section when it opens.
 * `source="brands"` leaves out the seeded sample drops; `hideWhenEmpty` renders nothing at all
 * when there is no drop (the demo pages, which show the sample drops above it).
 */
export function LiveDropsBoard({ source = "all", hideWhenEmpty = false, title }: { source?: "all" | "brands"; hideWhenEmpty?: boolean; title?: string }) {
  const hydrated = useHydrated()
  const now = useNow(30_000)
  // Beside the demo board (which owns #live, #upcoming…), the brands' sections take their own anchors.
  const idPrefix = source === "brands" ? "brands-" : ""
  const [feeds, setFeeds] = useState<Record<Source, Feed>>({ live: emptyFeed(), upcoming: emptyFeed(), ended: emptyFeed() })
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string }>({ kind: "loading" })
  const [retry, setRetry] = useState(0)

  const fetchPage = useCallback((phase: Source, cursor: string | null, signal?: AbortSignal) => api<DropPage>("/api/drops", { query: { phase, limit: PAGE_SIZE, ...(source === "brands" ? { source } : {}), ...(cursor ? { cursor } : {}) }, signal }), [source])

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all(SOURCES.map((phase) => fetchPage(phase, null, controller.signal)))
      .then(([live, upcoming, ended]) => {
        setFeeds({
          live: { ...emptyFeed(), items: live.items, cursor: live.nextCursor },
          upcoming: { ...emptyFeed(), items: upcoming.items, cursor: upcoming.nextCursor },
          ended: { ...emptyFeed(), items: ended.items, cursor: ended.nextCursor },
        })
        setState({ kind: "ready" })
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setState({ kind: "error", message: errorMessage(cause, "Drops couldn't be loaded.") })
      })
    return () => controller.abort()
  }, [fetchPage, retry])

  async function loadMore(phase: Source) {
    const feed = feeds[phase]
    if (!feed.cursor || feed.loadingMore) return
    setFeeds((current) => ({ ...current, [phase]: { ...current[phase], loadingMore: true, moreError: null } }))
    try {
      const page = await fetchPage(phase, feed.cursor)
      setFeeds((current) => {
        const seen = new Set(current[phase].items.map((drop) => drop.id))
        return { ...current, [phase]: { items: [...current[phase].items, ...page.items.filter((drop) => !seen.has(drop.id))], cursor: page.nextCursor, loadingMore: false, moreError: null } }
      })
    } catch (cause) {
      setFeeds((current) => ({ ...current, [phase]: { ...current[phase], loadingMore: false, moreError: errorMessage(cause, "More drops couldn't be loaded.") } }))
    }
  }

  if (state.kind === "loading") return hideWhenEmpty ? null : <div role="status" aria-label="Loading drops" className="mt-10 h-48 animate-pulse rounded-lg border border-line-soft bg-card/40" />
  if (state.kind === "error") return (
    <div role="alert" className="mt-10 flex flex-wrap items-center justify-between gap-4 border-y border-line-soft py-6">
      <p className="text-sm text-danger">{state.message}</p>
      <Button variant="secondary" onClick={() => { setState({ kind: "loading" }); setRetry((value) => value + 1) }}>Retry</Button>
    </div>
  )

  const groups: Group[] = [
    { id: "live", title: "Live now", description: "Releases open now, and draws whose winners are buying.", drops: [], more: "live" },
    { id: "entries-open", title: "Entries open", description: "Enter before the draw closes.", drops: [], more: null },
    { id: "upcoming", title: "Upcoming", description: "Set a reminder for the next release.", drops: [], more: "upcoming" },
    { id: "past", title: "Past drops", description: "Previous releases and draws.", drops: [], more: "ended" },
  ]
  const seen = new Set<string>()
  for (const drop of SOURCES.flatMap((phase) => feeds[phase].items)) {
    if (seen.has(drop.id)) continue
    seen.add(drop.id)
    groups.find((group) => group.id === groupOf(drop, dropPhaseAt(drop, now)))!.drops.push(drop)
  }
  groups[0].drops.sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
  groups[1].drops.sort((a, b) => Date.parse(a.entryClosesAt ?? a.startsAt) - Date.parse(b.entryClosesAt ?? b.startsAt))
  groups[2].drops.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
  groups[3].drops.sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))
  // An "upcoming" page that hasn't been read to the end carries its button under Upcoming, or under Entries open when Upcoming is empty.
  if (!groups[2].drops.length && feeds.upcoming.cursor) {
    groups[1].more = "upcoming"
    groups[2].more = null
  }

  if (seen.size === 0) {
    if (hideWhenEmpty) return null
    return (
      <div className="mt-10 border-y border-line-soft py-10 text-center">
        <CalendarClock className="mx-auto size-6 text-ink-3" />
        <p className="mt-3 font-display text-display-sm text-ink">No drops scheduled</p>
        <p className="mt-2 text-sm text-ink-2">New releases will appear here when brands schedule them.</p>
      </div>
    )
  }

  return (
    <div className="mt-10">
      {title ? <h2 className="mb-10 font-display text-display-md text-ink">{title}</h2> : null}
      {groups.filter((group) => group.drops.length > 0 || (group.more && feeds[group.more].cursor)).map((group) => {
        const feed = group.more ? feeds[group.more] : null
        return (
          <section key={group.id} id={`${idPrefix}${group.id}`} aria-labelledby={`${idPrefix}${group.id}-title`} className="mt-16 first:mt-0">
            <div id={`${idPrefix}${group.id}-title`}>
              <SectionHeader title={group.title} description={group.description} />
            </div>
            {group.drops.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {group.drops.map((drop) => <LiveDropCard key={drop.id} drop={drop} now={now} hydrated={hydrated} />)}
              </div>
            ) : null}
            {feed?.moreError ? <p role="alert" className="mt-5 text-sm text-danger">{feed.moreError}</p> : null}
            {feed?.cursor && group.more ? (
              <div className="mt-8 flex justify-center">
                <Button variant="secondary" loading={feed.loadingMore} disabled={feed.loadingMore} onClick={() => void loadMore(group.more!)}>
                  <ArrowRight aria-hidden /> {group.id === "past" ? "Load more past drops" : "Load more drops"}
                </Button>
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

export function LiveDropCard({ drop, now, hydrated }: { drop: PublicDropDto; now: number | null; hydrated: boolean }) {
  const phase = dropPhaseAt(drop, now)
  const handle = drop.brand.handle
  const brandName = drop.brand.name ?? "Independent brand"
  const winners = isWinnersWindow(drop, phase)
  const drawWaiting = drop.access === "draw" && phase === "upcoming" && !!drop.entryOpensAt
  const status = phase === "entries_open" ? "Entries open" : phase === "early_access" ? "Early access" : winners ? "Winners buying" : phase === "live" ? "Live now" : phase === "ended" ? (drop.access === "draw" ? "Draw closed" : "Ended") : "Upcoming"
  const timing =
    phase === "live" ? `${winners ? "Winners and the waitlist can buy until" : "Closes"} ${displayTime(drop.endsAt, hydrated)}`
    : phase === "ended" ? `Closed ${displayTime(drop.endsAt, hydrated)}`
    : phase === "entries_open" ? `Entries close ${displayTime(drop.entryClosesAt ?? drop.startsAt, hydrated)}`
    : drawWaiting ? `Entries open ${displayTime(drop.entryOpensAt!, hydrated)}`
    : `Releases ${displayTime(drop.startsAt, hydrated)}`
  const mode = dropActionMode(drop, phase)
  const src = dropImageSrc(drop.image)

  return (
    <article className="group/drop relative grid min-w-0 overflow-hidden rounded-lg border border-line-soft bg-obsidian sm:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <Link href={`/drops/${drop.slug}`} aria-label={`View ${drop.name}`} className="relative aspect-[4/3] overflow-hidden sm:aspect-auto sm:min-h-64">
        <Image src={src} alt={drop.name} fill unoptimized={isApiImage(src)} sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover transition-transform duration-700 group-hover/drop:scale-[1.03]" />
        {drop.sponsored ? <span className="absolute top-3 left-3 rounded-sm bg-card px-2 py-1 text-[10px] font-medium uppercase text-ink">Sponsored</span> : null}
      </Link>
      <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          {handle ? <Link href={brandHref(handle)} className="truncate text-xs text-ink-2 hover:text-ink">{brandName}</Link> : <span className="truncate text-xs text-ink-2">{brandName}</span>}
          <span className={cn("shrink-0 rounded-sm px-2 py-1 text-[10px] font-medium", (phase === "live" && !winners) || phase === "entries_open" ? "bg-acid text-obsidian" : "bg-elevated text-ink-2")}>{status}</span>
        </div>
        <Link href={`/drops/${drop.slug}`} className="font-display text-display-sm break-words text-ink hover:text-ink/80">{drop.name}</Link>
        <p className="line-clamp-2 text-sm leading-relaxed text-ink-2">{drop.description}</p>
        <div className="mt-auto border-t border-line-soft pt-3">
          <p className="text-xs text-ink-3">{accessLabel(drop.access)} · {pluralize(drop.totalUnits, "piece")} · limit {drop.limitPerCustomer}</p>
          <p className="mt-1 text-xs text-ink-2">{timing}{hydrated ? " · your time" : ""}</p>
          <div className="mt-4 flex min-w-0 justify-end">
            {mode ? <NotifyButton drop={{ id: drop.id, access: dropAccessForButton(drop.access) }} mode={mode} size="sm" />
              : phase === "live" && !winners ? <Button asChild size="sm" variant="secondary"><Link href={`/drops/${drop.slug}`}>Shop drop <ArrowRight /></Link></Button>
              : winners ? <Button asChild size="sm" variant="secondary"><Link href={`/drops/${drop.slug}`}>See results <ArrowRight /></Link></Button>
              : phase === "early_access" ? <Button asChild size="sm" variant="secondary"><Link href={`/drops/${drop.slug}`}>View drop <ArrowRight /></Link></Button>
              : null}
          </div>
        </div>
      </div>
    </article>
  )
}
