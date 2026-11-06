"use client"

import Image from "next/image"
import Link from "next/link"
import { SealCheckIcon } from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { CountUp } from "@/components/dashboard/insight/count-up"
import type { ChartEntryDto, ChartPeriod } from "@/lib/api/contracts/charts"
import { cn } from "@/lib/utils"
import { accessibleRow, dropStatusLabel, previousRankText, two } from "./format"
import { RankMove } from "./rank-move"

const hrefOf = (e: ChartEntryDto) => (e.drop ? `/drops/${e.drop.slug}` : `/brands/${e.brand.handle}`)

/**
 * Ranks 1–3 as editorial cards (§6.3 "Podium"): the cover under a scrim, an oversized rank, the
 * mark, name and seal, where it's from, the stat, the movement chip and the previous rank. Three
 * columns from md (the leader wider); on phones #1 runs full width with #2 and #3 side by side
 * beneath, so the order reads at a glance and nothing sits off-screen.
 */
export function Podium({ entries, period }: { entries: ChartEntryDto[]; period: ChartPeriod }) {
  const top = entries.slice(0, 3)
  if (!top.length) return null
  return (
    <ol aria-label="Top three" className="grid grid-cols-2 gap-3 md:grid-cols-[1.35fr_1fr_1fr] md:gap-4">
      {top.map((e, i) => (
        <PodiumCard key={e.subject.id} entry={e} period={period} lead={i === 0} />
      ))}
    </ol>
  )
}

function PodiumCard({ entry: e, period, lead }: { entry: ChartEntryDto; period: ChartPeriod; lead: boolean }) {
  const image = e.drop?.image ?? e.brand.cover
  const title = e.drop ? e.drop.name : e.brand.name
  return (
    <li className={cn("group/podium relative isolate overflow-hidden rounded-lg border border-line-soft bg-card", lead ? "col-span-2 md:col-span-1" : "col-span-1")}>
      <div className={cn("relative md:aspect-auto md:h-[28rem] xl:h-[31rem]", lead ? "aspect-[16/10]" : "aspect-[3/4]")}>
        {image ? (
          <Image
            src={image.src}
            alt=""
            fill
            sizes={lead ? "(min-width: 768px) 40vw, 100vw" : "(min-width: 768px) 28vw, 50vw"}
            priority={lead}
            className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover/podium:scale-[1.03]"
          />
        ) : (
          <span className="absolute inset-0 -z-10 bg-surface" />
        )}
        <span className="scrim-b absolute inset-0 -z-10" />
        <span className={cn("pointer-events-none absolute top-2 left-3 font-display leading-none tabular text-ink select-none md:top-3 md:left-4", lead ? "text-[5.5rem] md:text-[8.5rem]" : "text-[3.75rem] md:text-[6rem]")} aria-hidden>
          {two(e.rank)}
        </span>
        <div className="absolute top-3 right-3">
          <RankMove entry={e} size={lead ? "md" : "sm"} />
        </div>
        <div className={cn("absolute inset-x-0 bottom-0 grid gap-2 p-3 md:p-4", lead && "md:gap-3")}>
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandMark brand={e.brand} size={lead ? "md" : "sm"} className={cn("shrink-0", !lead && "max-md:hidden")} />
            <div className="min-w-0">
              <Link href={hrefOf(e)} className="flex items-center gap-1.5 font-medium text-ink outline-none after:absolute after:inset-0 after:z-10 focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-violet" aria-label={accessibleRow(e, period)}>
                <span className={cn(lead ? "truncate text-base md:text-lg" : "line-clamp-2 text-sm leading-tight md:truncate md:text-base")}>{title}</span>
                {!e.drop && e.brand.verified ? <SealCheckIcon weight="fill" className="size-4 shrink-0 text-violet" aria-hidden /> : null}
              </Link>
              <p className="truncate text-xs text-ink-2">{e.drop ? `${e.brand.name}, ${dropStatusLabel[e.drop.status].toLowerCase()}` : `${e.brand.category}, ${e.brand.city}`}</p>
            </div>
          </div>
          <div className={cn("flex flex-wrap items-end justify-between gap-x-3 gap-y-1", !lead && "max-md:flex-col max-md:items-start")}>
            <p className={cn("min-w-0 text-ink", !lead && "max-md:grid")}>
              <span className={cn("font-metric", lead ? "text-[1.75rem] md:text-[2.25rem]" : "text-[1.375rem] md:text-[1.75rem]")}>
                <CountUp text={e.stat.figure} />
              </span>
              <span className={cn("text-xs text-ink-2", lead ? "ml-1.5" : "max-md:truncate max-md:text-[11px] md:ml-1.5")}>{e.stat.caption}</span>
            </p>
            <p className="text-xs whitespace-nowrap text-ink-2 tabular">{previousRankText(e, period)}</p>
          </div>
        </div>
      </div>
    </li>
  )
}
