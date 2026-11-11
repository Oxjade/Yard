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
import { dropAccessForButton, dropImageSrc, dropPhaseAt, type PublicDropDetailDto, type PublicDrawInfoDto } from "@/lib/api/drops"
import type { Product } from "@/lib/data/types"

type DetailState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; detail: PublicDropDetailDto; products: Product[]; draw: PublicDrawInfoDto | null }

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

  useEffect(() => {
    const controller = new AbortController()
    void api<PublicDropDetailDto>(`/api/drops/${encodeURIComponent(slug)}`, { signal: controller.signal }).then(async (detail) => {
      const [products, draw] = await Promise.all([
        loadPublicProductsByIds(detail.drop.productIds, controller.signal),
        detail.drop.access === "draw" ? api<PublicDrawInfoDto>(`/api/drops/${encodeURIComponent(detail.drop.id)}/draw`, { signal: controller.signal }) : Promise.resolve(null),
      ])
      if (!controller.signal.aborted) setState({ kind: "ready", detail, products, draw })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setState({ kind: "error", message: errorMessage(cause, "This drop couldn't be loaded.") })
    })
    return () => controller.abort()
  }, [retry, slug])

  if (state.kind === "loading") return <div role="status" className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32"><div className="h-[55vh] min-h-72 animate-pulse rounded-lg bg-card" /></div>
  if (state.kind === "error") return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <p role="alert" className="border-y border-line-soft py-6 text-sm text-danger">{state.message}</p>
      <Button variant="secondary" className="mt-4" onClick={() => { setState({ kind: "loading" }); setRetry((value) => value + 1) }}>Retry</Button>
    </div>
  )

  const { drop, me } = state.detail
  const phase = dropPhaseAt(drop, now)
  const brandName = drop.brand.name ?? "Independent brand"
  const startsAt = Date.parse(drop.startsAt)
  const closesAt = drop.entryClosesAt ? Date.parse(drop.entryClosesAt) : startsAt
  const entriesOpen = phase === "entries_open"
  const earlyAccess = phase === "early_access"
  const live = phase === "live" && drop.access !== "draw"
  const closed = phase === "ended" || (phase === "live" && drop.access === "draw")
  const timing = phase === "upcoming" ? `Releases ${dateLabel(drop.startsAt, hydrated)}` : entriesOpen ? `Entries close ${dateLabel(drop.entryClosesAt ?? drop.startsAt, hydrated)}` : earlyAccess ? `Early access · public release ${dateLabel(drop.startsAt, hydrated)}` : live ? `Closes ${dateLabel(drop.endsAt, hydrated)}` : `Released ${dateLabel(drop.startsAt, hydrated)}`
  const countdown = phase === "upcoming" ? startsAt - (now ?? startsAt) : entriesOpen ? closesAt - (now ?? closesAt) : null

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Link href="/drops" className="inline-flex min-h-10 items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft /> All drops</Link>
      <div className="mt-5 grid gap-6 lg:grid-cols-12 lg:gap-8">
        <header className="lg:col-span-8">
          {drop.brand.handle ? <Link href={brandHref(drop.brand.handle)} className="text-sm text-ink-2 hover:text-ink">{brandName}</Link> : <p className="text-sm text-ink-2">{brandName}</p>}
          <h1 className="mt-3 font-display text-display-lg text-ink">{drop.name}</h1>
        </header>
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-card lg:col-span-8 lg:row-start-2 lg:aspect-auto lg:min-h-[560px]">
          <Image src={dropImageSrc(drop.image)} alt={drop.name} fill priority sizes="(min-width: 1024px) 65vw, 100vw" className="object-cover" />
          <span className="absolute top-3 left-3 rounded-sm bg-card/90 px-2 py-1 text-xs text-ink">{entriesOpen ? "Entries open" : earlyAccess ? "Early access" : live ? "Live now" : closed ? (drop.access === "draw" ? "Entries closed" : "Ended") : "Upcoming"}</span>
        </div>
        <aside className="grid content-start gap-4 lg:col-span-4 lg:row-start-2">
          <section className="rounded-lg border border-line-soft bg-card p-5 sm:p-6">
            <p className="text-xs uppercase text-ink-3">{drop.access === "draw" ? "Draw release" : drop.access === "early_access" ? "Early access release" : "Limited release"}</p>
            <p className="mt-2 font-display text-display-sm text-ink">{timing}</p>
            {countdown !== null && now !== null ? <p className="mt-2 text-sm tabular text-ink-2">{phase === "upcoming" ? "Opens in" : "Entries close in"} {timeRemaining(countdown)}</p> : null}
            <p className="mt-4 text-sm leading-relaxed text-ink-2">{drop.description}</p>
            <div className="mt-5 grid gap-2">
              {!closed && (phase === "upcoming" || entriesOpen) ? <NotifyButton drop={{ id: drop.id, access: dropAccessForButton(drop.access) }} size="lg" className="w-full" /> : null}
              {live ? <Link href="#pieces" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-acid px-4 text-sm font-medium text-obsidian">Shop this drop <ArrowRight /></Link> : null}
              {earlyAccess ? <p className="text-sm text-ink-2">Early access is available to eligible followers. Open a piece to check your access.</p> : null}
              {me && !me.canBuy && me.reason ? <p role="status" className="border-l-2 border-line py-1 pl-3 text-sm text-ink-2">{me.reason}</p> : null}
              {me?.entry ? <p className="text-xs text-ink-3">Your draw entry: {me.entry.status}{me.entry.rank ? ` · rank ${me.entry.rank}` : ""}</p> : null}
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line-soft pt-4 text-sm">
              <div><dt className="text-xs text-ink-3">Run</dt><dd className="mt-1">{drop.totalUnits} pieces</dd></div>
              <div><dt className="text-xs text-ink-3">Limit</dt><dd className="mt-1">{drop.limitPerCustomer} per customer</dd></div>
              {drop.access === "draw" && drop.winners ? <div><dt className="text-xs text-ink-3">Winners</dt><dd className="mt-1">{drop.winners}</dd></div> : null}
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
        {draw.me ? <div><dt className="text-xs text-ink-3">Your result</dt><dd className="mt-1 text-sm text-ink">{draw.me.status}{draw.me.rank ? ` · rank ${draw.me.rank}` : ""}</dd></div> : null}
      </dl>
    </section>
  )
}