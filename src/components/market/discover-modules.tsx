"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowCounterClockwiseIcon, ArrowRightIcon, MapPinIcon } from "@phosphor-icons/react"
import { RankMove } from "@/components/charts/rank-move"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { SampleChip } from "@/components/ui/sample-chip"
import { boardPath } from "@/lib/api/charts"
import { api } from "@/lib/api/client"
import { chartBoardDto, type ChartBoardDto, type ChartEntryDto } from "@/lib/api/contracts/charts"
import { useApi } from "@/lib/api/use-api"
import { brandById } from "@/lib/data/brands"
import type { ImageAsset } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { BrandMark } from "./brand-mark"

const TRENDING_WEEKLY = boardPath({ chart: "trending", period: "weekly" })
/** The route is public with a 5-minute max-age: the browser may answer from its cache. */
const getTrending = () => api<ChartBoardDto>(TRENDING_WEEKLY, { schema: chartBoardDto, cache: "default" })

/**
 * Discover's "On the charts this week" (§7.3): the top five of the weekly Trending board as
 * compact rows, from the same GET /api/charts the Charts page reads (never a number of its own).
 * One read per page view: the board changes once a day, so it isn't refetched on focus, and the
 * browser may reuse its cached copy for the route's 5-minute max-age. Rankings include the sample baseline in this build, so the module header
 * says so. Loading shows five row skeletons; a failed load says so with Retry; a board that has no
 * edition yet says it's warming up.
 */
export function ChartsThisWeek({ className }: { className?: string }) {
  const { data, error, isLoading, revalidate, isValidating } = useApi(TRENDING_WEEKLY, getTrending, { revalidateOnFocus: false })
  const entries = data?.entries.slice(0, 5) ?? []
  return (
    <section aria-labelledby="discover-charts-title" className={cn("flex min-w-0 flex-col rounded-xl border border-line-soft bg-card p-5 md:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="discover-charts-title" className="font-display text-display-sm text-ink">
            On the charts this week
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            Trending: who&apos;s gaining follows, views and saves fastest.
            <SampleChip label="Includes sample activity" />
          </p>
        </div>
        <Link href="/charts?chart=trending" className="group -my-1 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md text-sm text-ink-2 transition-colors hover:text-ink">
          Open Charts <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
        </Link>
      </div>

      <div className="mt-5 flex-1">
        {isLoading && !data ? (
          <ol role="status" aria-label="Loading the charts" className="grid grid-cols-[minmax(0,1fr)] gap-1">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex h-14 items-center gap-3 px-2">
                <Bone className="h-5 w-6" />
                <Bone className="size-9 shrink-0 rounded-full" />
                <div className="grid flex-1 gap-1.5">
                  <Bone className="h-3.5 w-32" />
                  <Bone className="h-3 w-24" />
                </div>
                <Bone className="h-4 w-12" />
              </li>
            ))}
          </ol>
        ) : error && !data ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 py-6 text-sm text-ink-2">
            Couldn&apos;t load the charts.
            <Button size="sm" variant="secondary" loading={isValidating} onClick={() => void revalidate()}>
              <ArrowCounterClockwiseIcon /> Retry
            </Button>
          </div>
        ) : !entries.length ? (
          <p className="py-6 text-sm text-ink-2">This week&apos;s Trending board is still filling up. Check back once brands have a few days of follows and views.</p>
        ) : (
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {entries.map((e) => (
              <ChartRow key={`${e.subject.type}:${e.subject.id}`} entry={e} />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function ChartRow({ entry: e }: { entry: ChartEntryDto }) {
  const brand = brandById.get(e.brand.id)
  return (
    <li>
      <Link href={`/brands/${e.brand.handle}`} className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-violet">
        <span className="w-6 shrink-0 font-display text-lg leading-none text-ink tabular">{String(e.rank).padStart(2, "0")}</span>
        {brand ? <BrandMark brand={brand} size="sm" /> : <span className="size-8 shrink-0 rounded-full bg-elevated" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{e.brand.name}</span>
          <span className="block truncate text-xs text-ink-2">
            {e.brand.category} in {e.brand.city}
          </span>
        </span>
        <span className="hidden shrink-0 text-right text-xs text-ink-2 sm:block">
          <span className="block text-sm text-ink tabular">{e.stat.figure}</span>
          {e.stat.caption}
        </span>
        <RankMove entry={e} size="sm" className="shrink-0" />
      </Link>
    </li>
  )
}

/**
 * Discover's Around teaser (§7.3): one card into the map. `image` is the live site's photo
 * (src/lib/site-images.ts); the demo keeps its sample one. Decorative: the card's text is its name.
 */
export function AroundTeaser({ className, image }: { className?: string; image?: ImageAsset }) {
  return (
    <Link
      href="/around"
      className={cn("group relative isolate flex min-h-[260px] min-w-0 flex-col justify-end overflow-hidden rounded-xl border border-line-soft bg-card p-5 md:p-6", className)}
    >
      <Image
        src={image?.src ?? "/media/lifestyle/cover-boutique-clothing-rails-01.jpg"}
        alt=""
        fill
        sizes="(min-width: 1024px) 34vw, 100vw"
        style={image?.position ? { objectPosition: image.position } : undefined}
        className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04] motion-reduce:transition-none"
      />
      <span className="scrim-b absolute inset-0 -z-10" />
      <span className="glass mb-auto inline-flex size-10 items-center justify-center self-start rounded-full">
        <MapPinIcon weight="fill" className="size-5 text-ink" aria-hidden />
      </span>
      <h2 className="mt-10 font-display text-display-sm text-ink">Find brands near you</h2>
      <p className="mt-2 max-w-xs text-sm text-ink/80">Stores, showrooms and pop-ups on Yard Around.</p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm text-ink">
        Open Around <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </span>
    </Link>
  )
}
