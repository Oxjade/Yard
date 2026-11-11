"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/market/section-header"
import { ProductCard } from "@/components/market/product-card"
import { NotifyButton } from "@/components/market/notify-button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useNow } from "@/hooks/use-now"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { loadPublicProductsByIds, brandHref } from "@/lib/api/catalog-products"
import { dropAccessForButton, dropActionMode, dropEntryStatus, dropImageSrc, dropPhaseAt, isApiImage, type DropPhaseDto, type PublicDropDetailDto, type PublicDrawInfoDto } from "@/lib/api/drops"
import type { Product } from "@/lib/data/types"
import { pluralize } from "@/lib/utils"

type DetailState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; detail: PublicDropDetailDto; products: Product[]; draw: PublicDrawInfoDto | null; phase: DropPhaseDto }

const localDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" })
const utcDate = new Intl.DateTimeFormat("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" })

function dateLabel(value: string, hydrated: boolean) {
  return (hydrated ? localDate : utcDate).format(new Date(value))
}

function timeRemaining(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days) return `${days}d ${hours}h`
  if (hours) return `${hours}h ${rest}m`
  return `${rest}m`
}

export function LiveDropDetail({ slug }: { slug: string }) {
  const hydrated = useHydrated()
  const now = useNow(1000)
  const [state, setState] = useState<DetailState>({ kind: "loading" })
  const [retry, setRetry] = useState(0)
  // Bumped to reload quietly (the page stays on screen): when the phase changes on this clock, and after an entry or reminder.
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void api<PublicDropDetailDto>(`/api/drops/${encodeURIComponent(slug)}`, { signal: controller.signal }).then(async (detail) => {
      const [products, draw] = await Promise.all([
        loadPublicProductsByIds(detail.drop.productIds, controller.signal),
        detail.drop.access === "draw" ? api<PublicDrawInfoDto>(`/api/drops/${encodeURIComponent(detail.drop.id)}/draw`, { signal: controller.signal }) : Promise.resolve(null),
      ])
      if (!controller.signal.aborted) setState({ kind: "ready", detail, products, draw, phase: dropPhaseAt(detail.drop, Date.now()) })
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      // A quiet reload that fails keeps what is on screen; only the first load shows the error.
      setState((current) => current.kind === "ready" ? current : { kind: "error", message: errorMessage(cause, "This drop couldn't be loaded.") })
    })
    return () => controller.abort()
  }, [retry, refresh, slug])

  const phase = state.kind === "ready" ? dropPhaseAt(state.detail.drop, now) : null
  const loadedPhase = state.kind === "ready" ? state.phase : null
  // The countdown crossed a boundary (entries opened or closed, release, end): read the server's state again, once per new phase.
  const [requestedPhase, setRequestedPhase] = useState<DropPhaseDto | null>(null)
  if (phase && loadedPhase && phase !== loadedPhase && requestedPhase !== phase) {
    setRequestedPhase(phase)
    setRefresh((value) => value + 1)
  }

  if (state.kind === "loading") return <div role="status" aria-label="Loading drop" className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32"><div className="h-[55vh] min-h-72 animate-pulse rounded-lg bg-card" /></div>
  if (state.kind === "error") return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <p role="alert" className="border-y border-line-soft py-6 text-sm text-danger">{state.message}</p>
      <Button variant="secondary" className="mt-4" onClick={() => { setState({ kind: "loading" }); setRetry((value) => value + 1) }}>Retry</Button>
    </div>
  )

  const { drop, me } = state.detail
  const current = phase ?? state.phase
  const brandName = drop.brand.name ?? "Independent brand"
  const startsAt = Date.parse(drop.startsAt)
  const closesAt = drop.entryClosesAt ? Date.parse(drop.entryClosesAt) : startsAt
  const entriesOpen = current === "entries_open"
  const earlyAccess = current === "early_access"
  const winnersWindow = current === "live" && drop.access === "draw"
  const live = current === "live" && drop.access !== "draw"
  const ended = current === "ended"
  const entry = me?.entry ?? null
  const winner = entry?.status === "won"
  const drawWaiting = drop.access === "draw" && current === "upcoming" && !!drop.entryOpensAt && Date.parse(drop.entryOpensAt) > (now ?? 0)
  const timing =
    drawWaiting ? `Entries open ${dateLabel(drop.entryOpensAt!, hydrated)}`
    : current === "upcoming" ? `Releases ${dateLabel(drop.startsAt, hydrated)}`
    : entriesOpen ? `Entries close ${dateLabel(drop.entryClosesAt ?? drop.startsAt, hydrated)}`
    : earlyAccess ? `Early access · public release ${dateLabel(drop.startsAt, hydrated)}`
    : live ? `Closes ${dateLabel(drop.endsAt, hydrated)}`
    // The drop's end covers the whole draw window, the waitlist's turns included. A winner sees
    // their own deadline above ("Buy your piece by …"), so for them this line is about the
    // waitlist's last chance, not a later deadline of theirs.
    : winnersWindow ? `${winner ? "Last chance for the waitlist:" : "Winners and the waitlist can buy until"} ${dateLabel(drop.endsAt, hydrated)}`
    : `Released ${dateLabel(drop.startsAt, hydrated)}`
  const countdown = drawWaiting ? Date.parse(drop.entryOpensAt!) - (now ?? 0) : current === "upcoming" ? startsAt - (now ?? startsAt) : entriesOpen ? closesAt - (now ?? closesAt) : null
  const countdownLabel = drawWaiting ? "Entries open in" : current === "upcoming" ? (drop.access === "draw" ? "Entries close in" : "Opens in") : "Entries close in"
  const badge = entriesOpen ? "Entries open" : earlyAccess ? "Early access" : live ? "Live now" : winnersWindow ? "Winners buying" : ended ? (drop.access === "draw" ? "Draw closed" : "Ended") : "Upcoming"
  const mode = dropActionMode(drop, current)
  const entryLabel = entry ? dropEntryStatus(entry.status).label : null
  const windowOpens = entry?.windowOpensAt ? Date.parse(entry.windowOpensAt) : null
  const src = dropImageSrc(drop.image)
  const reload = () => setRefresh((value) => value + 1)

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Link href="/drops" className="inline-flex min-h-10 items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft /> All drops</Link>
      <div className="mt-5 grid gap-6 lg:grid-cols-12 lg:gap-8">
        <header className="min-w-0 lg:col-span-8">
          {drop.brand.handle ? <Link href={brandHref(drop.brand.handle)} className="text-sm text-ink-2 hover:text-ink">{brandName}</Link> : <p className="text-sm text-ink-2">{brandName}</p>}
          <h1 className="mt-3 font-display text-display-lg break-words text-ink">{drop.name}</h1>
        </header>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-card lg:col-span-8 lg:row-start-2 lg:aspect-auto lg:min-h-[560px]">
          <Image src={src} alt={drop.name} fill priority unoptimized={isApiImage(src)} sizes="(min-width: 1024px) 65vw, 100vw" className="object-cover" />
          <span className="absolute top-3 left-3 rounded-sm bg-card/90 px-2 py-1 text-xs text-ink">{badge}</span>
        </div>
        <aside className="grid min-w-0 content-start gap-4 lg:col-span-4 lg:row-start-2">
          {winner && me ? (
            <section aria-labelledby="winner-title" className="rounded-lg border border-acid/40 bg-card p-5 sm:p-6">
              <h2 id="winner-title" className="font-display text-display-sm text-ink">You won the draw</h2>
              {me.canBuy && entry?.windowEndsAt ? (
                <>
                  <p className="mt-2 text-sm text-ink-2">Buy your piece by {dateLabel(entry.windowEndsAt, hydrated)}{hydrated ? " (your time)" : ""}. After that, your place goes to the next person on the waitlist.</p>
                  <Link href="#pieces" className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-acid px-4 text-sm font-medium text-obsidian">Buy now <ArrowRight /></Link>
                </>
              ) : windowOpens && windowOpens > (now ?? 0) ? (
                <p className="mt-2 text-sm text-ink-2">Your purchase window opens {dateLabel(entry!.windowOpensAt!, hydrated)}{entry?.windowEndsAt ? ` and closes ${dateLabel(entry.windowEndsAt, hydrated)}` : ""}{hydrated ? " (your time)" : ""}.</p>
              ) : me.reason ? <p className="mt-2 text-sm text-ink-2">{me.reason}</p> : null}
            </section>
          ) : null}
          <section className="rounded-lg border border-line-soft bg-card p-5 sm:p-6">
            <p className="text-xs uppercase text-ink-3">{drop.access === "draw" ? "Draw release" : drop.access === "early_access" ? "Early access release" : "Limited release"}</p>
            <p className="mt-2 font-display text-display-sm text-ink">{timing}</p>
            {countdown !== null && now !== null ? <p className="mt-2 text-sm tabular text-ink-2">{countdownLabel} {timeRemaining(countdown)}</p> : null}
            <p className="mt-4 text-sm leading-relaxed break-words text-ink-2">{drop.description}</p>
            <div className="mt-5 grid gap-2">
              {mode ? <NotifyButton drop={{ id: drop.id, access: dropAccessForButton(drop.access) }} mode={mode} size="lg" className="w-full" onChange={reload} /> : null}
              {drawWaiting ? <p className="text-xs text-ink-3">Set a reminder now; you can enter once entries open.</p> : null}
              {live ? <Link href="#pieces" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-acid px-4 text-sm font-medium text-obsidian">Shop this drop <ArrowRight /></Link> : null}
              {earlyAccess ? <p className="text-sm text-ink-2">Early access is available to eligible followers. Open a piece to check your access.</p> : null}
              {winnersWindow && !winner ? <p className="text-sm text-ink-2">Entries are closed. Drawn winners are buying now; the results are below.</p> : null}
              {me && !me.canBuy && me.reason && !winner ? <p role="status" className="border-l-2 border-line py-1 pl-3 text-sm text-ink-2">{me.reason}</p> : null}
              {entry && entryLabel && !winner ? <p className="text-xs text-ink-3">Your draw entry: {entryLabel}{entry.rank ? ` · position ${entry.rank}` : ""}</p> : null}
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm">
              <div><dt className="text-xs text-ink-3">Run</dt><dd className="mt-1">{pluralize(drop.totalUnits, "piece")}</dd></div>
              <div><dt className="text-xs text-ink-3">Limit</dt><dd className="mt-1">{drop.limitPerCustomer} per customer</dd></div>
              {drop.access === "draw" && drop.winners ? <div><dt className="text-xs text-ink-3">Winners</dt><dd className="mt-1">{drop.winners}</dd></div> : null}
              {drop.access === "draw" && drop.purchaseWindowMinutes ? <div><dt className="text-xs text-ink-3">Winner window</dt><dd className="mt-1">{windowLength(drop.purchaseWindowMinutes)}</dd></div> : null}
            </dl>
          </section>
        </aside>
      </div>

      {drop.access === "draw" && state.draw ? <DrawFairness draw={state.draw} hydrated={hydrated} /> : null}

      <section id="pieces" aria-labelledby="pieces-title" className="mt-20 scroll-mt-24 md:mt-28">
        <div id="pieces-title"><SectionHeader title="In this drop" description="Checkout confirms availability and enforces the drop's purchase rules." /></div>
        {state.products.length ? <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 lg:grid-cols-4">{state.products.map((product) => <ProductCard key={product.id} product={product} priority />)}</div> : <p className="mt-6 border-y border-line-soft py-6 text-sm text-ink-2">The pieces in this drop aren&apos;t available to view right now.</p>}
      </section>
    </div>
  )
}

function windowLength(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`
  return `${minutes} minute${minutes === 1 ? "" : "s"}`
}

function DrawFairness({ draw, hydrated }: { draw: PublicDrawInfoDto; hydrated: boolean }) {
  return (
    <section aria-labelledby="draw-fairness-title" className="mt-16 border-y border-line-soft py-6 md:mt-20">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-1 size-5 shrink-0 text-acid" />
        <div className="min-w-0">
          <h2 id="draw-fairness-title" className="font-display text-display-sm text-ink">Draw fairness</h2>
          <p className="mt-2 text-sm text-ink-2">The seed hash is published before the draw. The seed is revealed after the draw so the result can be checked.</p>
        </div>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-xs text-ink-3">Algorithm</dt><dd className="mt-1 break-words text-sm text-ink">{draw.algorithm}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-ink-3">Entries</dt><dd className="mt-1 text-sm text-ink">{draw.counts.entries}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-ink-3">Committed seed hash</dt><dd className="mt-1 break-all font-mono text-xs text-ink">{draw.seedHash ?? "Not published"}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-ink-3">Revealed seed</dt><dd className="mt-1 break-all font-mono text-xs text-ink">{draw.seed ?? "Revealed after the draw"}</dd></div>
        {draw.drawnAt ? <div><dt className="text-xs text-ink-3">Drawn</dt><dd className="mt-1 text-sm text-ink">{dateLabel(draw.drawnAt, hydrated)}</dd></div> : null}
        {draw.me ? <div><dt className="text-xs text-ink-3">Your result</dt><dd className="mt-1 text-sm text-ink">{dropEntryStatus(draw.me.status).label}{draw.me.rank ? ` · position ${draw.me.rank}` : ""}</dd></div> : null}
      </dl>
    </section>
  )
}