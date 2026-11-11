"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon as ArrowRight, CalendarDotsIcon as CalendarClock } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { brandHref } from "@/lib/api/catalog-products"
import { dropAccessForButton, dropImageSrc, dropPhaseAt, type PublicDropDto } from "@/lib/api/drops"
import { cn } from "@/lib/utils"
import { NotifyButton } from "./notify-button"
import { SectionHeader } from "./section-header"

type DropPage = { items: PublicDropDto[]; nextCursor: string | null }
type LoadState = "loading" | "ready" | "error"
type Group = { id: string; title: string; description: string; drops: PublicDropDto[] }

const PAGE_SIZE = 24
const utcDate = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })
const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

function accessLabel(access: PublicDropDto["access"]) {
  return access === "draw" ? "Draw" : access === "early_access" ? "Early access" : "First come"
}

function displayTime(value: string, hydrated: boolean) {
  const date = new Date(value)
  return (hydrated ? localDate : utcDate).format(date)
}

export function LiveDropsBoard() {
  const hydrated = useHydrated()
  const now = useNow(30_000)
  const [items, setItems] = useState<PublicDropDto[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void api<DropPage>("/api/drops", { query: { phase: "all", limit: PAGE_SIZE }, signal: controller.signal }).then((page) => {
      setItems(page.items)
      setCursor(page.nextCursor)
      setLoadState("ready")
      setError(null)
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setLoadState("error")
        setError(errorMessage(cause, "Drops couldn't be loaded."))
      }
    })
    return () => controller.abort()
  }, [retry])

  async function loadMore() {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await api<DropPage>("/api/drops", { query: { phase: "all", limit: PAGE_SIZE, cursor } })
      setItems((current) => {
        const seen = new Set(current.map((drop) => drop.id))
        return [...current, ...page.items.filter((drop) => !seen.has(drop.id))]
      })
      setCursor(page.nextCursor)
    } catch (cause) {
      setMoreError(errorMessage(cause, "More drops couldn't be loaded."))
    } finally {
      setLoadingMore(false)
    }
  }

  const groups: Group[] = [
    { id: "live", title: "Live now", description: "Releases that are open now.", drops: [] },
    { id: "entries-open", title: "Entries open", description: "Enter before the draw closes.", drops: [] },
    { id: "upcoming", title: "Upcoming", description: "Set a reminder for the next release.", drops: [] },
    { id: "past", title: "Past drops", description: "Previous releases and draws.", drops: [] },
  ]
  for (const drop of items) {
    const phase = dropPhaseAt(drop, now)
    const group = phase === "ended" ? groups[3] : phase === "entries_open" ? groups[1] : phase === "upcoming" || phase === "early_access" ? groups[2] : drop.access === "draw" ? groups[3] : groups[0]
    group.drops.push(drop)
  }
  groups[3].drops.sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))

  if (loadState === "loading") return <div role="status" className="mt-10 h-48 animate-pulse rounded-lg border border-line-soft bg-card/40" />
  if (loadState === "error") return (
    <div role="alert" className="mt-10 flex flex-wrap items-center justify-between gap-4 border-y border-line-soft py-6">
      <p className="text-sm text-danger">{error}</p>
      <Button variant="secondary" onClick={() => { setLoadState("loading"); setRetry((value) => value + 1) }}>Retry</Button>
    </div>
  )
  if (items.length === 0) return (
    <div className="mt-10 border-y border-line-soft py-10 text-center">
      <CalendarClock className="mx-auto size-6 text-ink-3" />
      <p className="mt-3 font-display text-display-sm text-ink">No drops scheduled</p>
      <p className="mt-2 text-sm text-ink-2">New releases will appear here when brands schedule them.</p>
    </div>
  )

  return (
    <div className="mt-10">
      {groups.filter((group) => group.drops.length > 0).map((group) => {
        return (
          <section key={group.id} id={group.id} aria-labelledby={`${group.id}-title`} className="mt-16 first:mt-0">
            <div id={`${group.id}-title`}>
              <SectionHeader title={group.title} description={group.description} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {group.drops.map((drop) => <LiveDropCard key={drop.id} drop={drop} now={now} hydrated={hydrated} />)}
            </div>
          </section>
        )
      })}

      {moreError ? <p role="alert" className="mt-5 text-sm text-danger">{moreError}</p> : null}
      {cursor ? (
        <div className="mt-10 flex justify-center">
          <Button variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={loadMore}>
            <IconLoadMore /> Load more drops
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function LiveDropCard({ drop, now, hydrated }: { drop: PublicDropDto; now: number | null; hydrated: boolean }) {
  const phase = dropPhaseAt(drop, now)
  const handle = drop.brand.handle
  const brandName = drop.brand.name ?? "Independent brand"
  const date = phase === "live" ? drop.endsAt : drop.startsAt
  const status = phase === "entries_open" ? "Entries open" : phase === "early_access" ? "Early access" : phase === "live" ? "Live now" : phase === "ended" ? (drop.access === "draw" ? "Draw closed" : "Ended") : "Upcoming"
  const buttonDrop = { id: drop.id, access: dropAccessForButton(drop.access) }

  return (
    <article className="group/drop relative grid min-w-0 overflow-hidden rounded-lg border border-line-soft bg-obsidian sm:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <Link href={`/drops/${drop.slug}`} aria-label={`View ${drop.name}`} className="relative aspect-[4/3] overflow-hidden sm:aspect-auto sm:min-h-64">
        <Image src={dropImageSrc(drop.image)} alt={drop.name} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover transition-transform duration-700 group-hover/drop:scale-[1.03]" />
        {drop.sponsored ? <span className="absolute top-3 left-3 rounded-sm bg-card px-2 py-1 text-[10px] font-medium uppercase text-ink">Sponsored</span> : null}
      </Link>
      <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          {handle ? <Link href={brandHref(handle)} className="truncate text-xs text-ink-2 hover:text-ink">{brandName}</Link> : <span className="truncate text-xs text-ink-2">{brandName}</span>}
          <span className={cn("shrink-0 rounded-sm px-2 py-1 text-[10px] font-medium", phase === "live" || phase === "entries_open" ? "bg-acid text-obsidian" : "bg-elevated text-ink-2")}>{status}</span>
        </div>
        <Link href={`/drops/${drop.slug}`} className="font-display text-display-sm text-ink hover:text-ink/80">{drop.name}</Link>
        <p className="line-clamp-2 text-sm leading-relaxed text-ink-2">{drop.description}</p>
        <div className="mt-auto border-t border-line-soft pt-3">
          <p className="text-xs text-ink-3">{accessLabel(drop.access)} · {drop.totalUnits} pieces · limit {drop.limitPerCustomer}</p>
          <p className="mt-1 text-xs text-ink-2">
            {phase === "live" ? "Closes" : phase === "ended" ? "Closed" : drop.access === "draw" ? "Entries close" : "Releases"} {displayTime(date, hydrated)}{hydrated ? " · your time" : ""}
          </p>
          <div className="mt-4 flex min-w-0 justify-end">
            {phase === "upcoming" || phase === "entries_open" ? <NotifyButton drop={buttonDrop} size="sm" /> : phase === "live" && drop.access !== "draw" ? <Button asChild size="sm" variant="secondary"><Link href={`/drops/${drop.slug}`}>Shop drop <ArrowRight /></Link></Button> : phase === "early_access" ? <Button asChild size="sm" variant="secondary"><Link href={`/drops/${drop.slug}`}>View drop <ArrowRight /></Link></Button> : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function IconLoadMore() {
  return <ArrowRight aria-hidden />
}