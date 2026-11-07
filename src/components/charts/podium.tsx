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
 * Ranks 1–3 as editorial cards (§6.3 "Podium"): the cover with an oversized rank, then the mark,
 * name and seal, where it's from, the stat, the movement chip and the previous rank. Three columns
 * from md (the leader wider); on phones #1 runs full width with #2 and #3 side by side beneath, so
 * the order reads at a glance and nothing sits off-screen. A board with only two entries gets two
 * equal columns (stacked on phones), and a board with one gets a single wide card with the photo
 * beside its panel, so a short board never leaves most of the row empty.
 *
 * Nothing is written straight on the photo: the rank sits on a solid black tab in the corner and
 * every word and number sits on the card's solid panel under the photo, so a white clothing rack
 * reads as well as a night street (no scrim or gradient to rely on).
 */
export function Podium({ entries, period }: { entries: ChartEntryDto[]; period: ChartPeriod }) {
  const top = entries.slice(0, 3)
  if (!top.length) return null
  const shape: Shape = top.length === 1 ? "solo" : top.length === 2 ? "pair" : "trio"
  return (
    <ol aria-label={top.length === 1 ? "Number one" : top.length === 2 ? "Top two" : "Top three"} className={cn("grid gap-3 md:gap-4", shape === "trio" ? "grid-cols-2 md:grid-cols-[1.35fr_1fr_1fr]" : shape === "pair" ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1")}>
      {top.map((e, i) => (
        <PodiumCard key={e.subject.id} entry={e} period={period} lead={i === 0} shape={shape} />
      ))}
    </ol>
  )
}

type Shape = "trio" | "pair" | "solo"

function PodiumCard({ entry: e, period, lead, shape }: { entry: ChartEntryDto; period: ChartPeriod; lead: boolean; shape: Shape }) {
  const image = e.drop?.image ?? e.brand.cover
  const title = e.drop ? e.drop.name : e.brand.name
  const solo = shape === "solo"
  // Full-width cards on phones (every card of a pair, the leader of a trio) take the wide photo.
  const wide = lead || shape !== "trio"
  return (
    <li
      className={cn(
        "group/podium relative isolate flex flex-col overflow-hidden rounded-lg border border-line-soft bg-card",
        solo ? "md:h-[22rem] md:flex-row" : "md:h-[28rem] xl:h-[31rem]",
        shape === "trio" ? (lead ? "col-span-2 md:col-span-1" : "col-span-1") : "col-span-1",
      )}
    >
      <div className={cn("relative shrink-0 overflow-hidden bg-surface", wide ? "aspect-[16/9]" : "aspect-[4/3]", solo ? "md:aspect-auto md:h-full md:w-3/5" : "md:aspect-auto md:min-h-0 md:flex-1")}>
        {image ? (
          <Image
            src={image.src}
            alt=""
            fill
            sizes={solo ? "(min-width: 768px) 60vw, 100vw" : lead || shape === "pair" ? "(min-width: 768px) 45vw, 100vw" : "(min-width: 768px) 28vw, 50vw"}
            priority={lead}
            className="object-cover transition-transform duration-[900ms] ease-out-quint group-hover/podium:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/podium:scale-100"
          />
        ) : null}
        <span
          className={cn(
            "pointer-events-none absolute top-0 left-0 bg-obsidian font-display leading-[0.82] tabular text-ink select-none",
            lead ? "px-3 pt-2.5 pb-1.5 text-[3.5rem] md:px-4 md:pt-3.5 md:pb-2 md:text-[6rem]" : "px-2.5 pt-2 pb-1 text-[2.5rem] md:px-3 md:pt-3 md:pb-1.5 md:text-[4.25rem]",
          )}
          aria-hidden
        >
          {two(e.rank)}
        </span>
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col gap-2.5 border-line-soft bg-card p-3 md:p-4",
          solo ? "border-t md:justify-center md:gap-4 md:border-t-0 md:border-l md:p-8" : "border-t md:h-44 md:flex-none md:justify-between",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark brand={e.brand} size={lead ? "md" : "sm"} className={cn("shrink-0", !wide && "max-md:hidden")} />
          <div className="min-w-0">
            <Link
              href={hrefOf(e)}
              className="flex items-center gap-1.5 font-medium text-ink outline-none after:absolute after:inset-0 after:z-10 focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-violet focus-visible:after:ring-inset"
              aria-label={accessibleRow(e, period)}
            >
              <span className={cn(wide ? "truncate text-base md:text-lg" : "line-clamp-2 text-sm leading-tight md:truncate md:text-base", solo && "md:text-2xl")}>{title}</span>
              {!e.drop && e.brand.verified ? <SealCheckIcon weight="fill" className="size-4 shrink-0 text-violet" aria-hidden /> : null}
            </Link>
            <p className="truncate text-xs text-ink-2">{e.drop ? `${e.brand.name}, ${dropStatusLabel[e.drop.status].toLowerCase()}` : [e.brand.category, e.brand.city].filter(Boolean).join(", ")}</p>
          </div>
        </div>
        <p className={cn("min-w-0 text-ink", !wide && "max-md:grid")}>
          <span className={cn("font-metric", lead ? "text-[1.75rem] md:text-[2.25rem]" : "text-[1.375rem] md:text-[1.75rem]", solo && "md:text-[3rem]")}>
            <CountUp text={e.stat.figure} />
          </span>
          <span className={cn("text-xs text-ink-2", wide ? "ml-1.5" : "max-md:truncate max-md:text-[11px] md:ml-1.5")}>{e.stat.caption}</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 max-md:mt-auto">
          <RankMove entry={e} size="sm" />
          <p className="text-xs whitespace-nowrap text-ink-2 tabular">{previousRankText(e, period)}</p>
        </div>
      </div>
    </li>
  )
}
