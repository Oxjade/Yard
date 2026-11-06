"use client"

import Image from "next/image"
import Link from "next/link"
import { SealCheckIcon } from "@phosphor-icons/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CountUp } from "@/components/dashboard/insight/count-up"
import { BrandMark } from "@/components/market/brand-mark"
import { FollowButton } from "@/components/market/follow-button"
import type { ChartEntryDto, ChartPeriod } from "@/lib/api/contracts/charts"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { accessibleRow, dropStatusLabel, periodWords, two } from "./format"
import { RankMove } from "./rank-move"
import { RankSparkline } from "./rank-sparkline"

/** The grid every row and the column header share (md up: history columns; lg up: sparkline and Follow). */
const grid = "grid grid-cols-[2.75rem_minmax(0,1fr)_4.75rem] items-center gap-x-2.5 md:gap-x-3 md:grid-cols-[7.25rem_minmax(0,1fr)_3.5rem_3rem_3.5rem_8rem] lg:grid-cols-[7.25rem_minmax(0,1fr)_4rem_3rem_3.5rem_9rem_5.5rem_6.5rem]"

/** Column headings for md up ("Last week", "Peak", "Weeks"). Phones carry the same facts in a meta line. */
export function ListHeader({ period, drops }: { period: ChartPeriod; drops: boolean }) {
  const w = periodWords[period]
  return (
    <div className={cn(grid, "hidden h-9 border-b border-line-soft px-3 text-[11px] text-ink-3 md:grid")} aria-hidden>
      <span>Rank</span>
      <span>{drops ? "Drop" : "Brand"}</span>
      <span className="text-right">{w.prev}</span>
      <span className="text-right">Peak</span>
      <span className="text-right">{w.column}</span>
      <span className="text-right">This edition</span>
      <span className="hidden text-right lg:block">Trend</span>
      <span className="hidden lg:block" />
    </div>
  )
}

/**
 * Ranks 4–50 (§6.3 "Rows"), 64 px each, in an ordered list. Rows glide to their new places when a
 * refresh reorders them (layout animation on spring.layout); reduced motion swaps them in place.
 * The whole row opens the storefront (or the drop); Follow sits above that link.
 */
export function ChartList({ entries, period, start, size }: { entries: ChartEntryDto[]; period: ChartPeriod; start: number; size: number }) {
  const reduce = useReducedMotion()
  if (!entries.length) return null
  return (
    <ol start={start} className="relative">
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <motion.li
            key={e.subject.id}
            layout={reduce ? false : "position"}
            transition={spring.layout}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative border-b border-line-soft last:border-b-0"
          >
            <Row entry={e} period={period} size={size} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}

function Row({ entry: e, period, size }: { entry: ChartEntryDto; period: ChartPeriod; size: number }) {
  const w = periodWords[period]
  const href = e.drop ? `/drops/${e.drop.slug}` : `/brands/${e.brand.handle}`
  const fresh = e.movement === "new" || e.movement === "reentry"
  const prev = e.movement === "new" ? w.isNew : e.movement === "reentry" ? "Back on the chart" : null
  return (
    <div className={cn(grid, "group/row min-h-16 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.025] md:px-3")}>
      {/* Rank and movement: stacked on phones, side by side from md */}
      <div className="flex flex-col items-start gap-1 md:flex-row md:items-center md:gap-2.5">
        <AnimatedRank rank={e.rank} />
        <RankMove entry={e} size="sm" />
      </div>

      {/* Identity */}
      <div className="flex min-w-0 items-center gap-3">
        {e.drop ? (
          <span className="relative size-9 shrink-0 overflow-hidden rounded-[5px] border border-white/12 bg-surface md:size-10">
            <Image src={e.drop.image.src} alt="" fill sizes="40px" className="object-cover" />
          </span>
        ) : (
          <BrandMark brand={e.brand} className="size-9 rounded-[5px] text-[12px] md:size-10 md:text-[13px]" />
        )}
        <div className="min-w-0">
          <Link href={href} aria-label={accessibleRow(e, period)} className="flex items-center gap-1.5 text-sm font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-violet">
            <span className="truncate">{e.drop ? e.drop.name : e.brand.name}</span>
            {!e.drop && e.brand.verified ? <SealCheckIcon weight="fill" className="size-3.5 shrink-0 text-violet" aria-hidden /> : null}
            {e.drop ? <DropStatus status={e.drop.status} /> : null}
          </Link>
          {/* md up: where it's from; phones: the movement and the chart history. */}
          <p className="hidden truncate text-xs text-ink-2 md:block">{e.drop ? e.brand.name : `${e.brand.category}, ${e.brand.city}`}</p>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2.5 text-[11px] leading-4 text-ink-2 tabular md:hidden">
            {prev ? (
              <span className="truncate">{prev}</span>
            ) : (
              <>
                <span className="whitespace-nowrap">
                  {w.prev} <span className="text-ink">{e.prevRank}</span>
                </span>
                <span className="whitespace-nowrap">
                  Peak <span className="text-ink">{e.peak}</span>
                </span>
                <span className="truncate">{w.unit(e.editionsOnChart)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* md up: history columns */}
      {fresh ? (
        <span className="col-span-3 hidden text-right text-xs text-ink-2 md:block">{prev}</span>
      ) : (
        <>
          <span className="hidden text-right text-sm text-ink-2 tabular md:block">{e.prevRank}</span>
          <span className="hidden text-right text-sm text-ink-2 tabular md:block">{e.peak}</span>
          <span className="hidden text-right text-sm text-ink-2 tabular md:block">{e.editionsOnChart}</span>
        </>
      )}

      {/* The stat */}
      <p className="min-w-0 text-right leading-tight">
        <span className="block font-metric text-lg text-ink">
          <CountUp text={e.stat.figure} />
        </span>
        <span className="block text-[10px] leading-3 text-ink-3 max-md:line-clamp-2 md:truncate md:text-[11px] md:leading-tight">{e.stat.caption}</span>
      </p>

      {/* lg up: sparkline and Follow */}
      <span className="hidden justify-end lg:flex">
        <RankSparkline history={e.history} size={size} />
      </span>
      <span className="hidden justify-end lg:flex">{e.drop ? null : <FollowButton brandId={e.brand.id} brandName={e.brand.name} size="xs" />}</span>
    </div>
  )
}

/** The rank numeral rolls to its new value when a refresh moves the row; reduced motion swaps it. */
function AnimatedRank({ rank }: { rank: number }) {
  const reduce = useReducedMotion()
  return (
    <span className="relative inline-flex h-8 w-[2.1ch] shrink-0 overflow-hidden font-display text-[1.75rem] leading-8 text-ink tabular md:text-[2rem]" aria-hidden>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={rank} initial={reduce ? { opacity: 0 } : { y: "100%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: "-100%", opacity: 0 }} transition={spring.layout}>
          {two(rank)}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function DropStatus({ status }: { status: NonNullable<ChartEntryDto["drop"]>["status"] }) {
  return (
    <span className={cn("ml-1 inline-flex h-5 shrink-0 items-center rounded-[4px] border px-1.5 text-[10px] font-normal", status === "live" ? "border-acid/50 text-acid" : status === "upcoming" ? "border-purple/60 text-violet" : "border-white/12 text-ink-2")}>
      {status === "upcoming" ? "Upcoming" : dropStatusLabel[status]}
    </span>
  )
}
