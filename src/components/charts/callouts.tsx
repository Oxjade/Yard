"use client"

import Link from "next/link"
import { ArrowUpRightIcon, SparkleIcon } from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import type { ChartBoardDto, ChartEntryDto, ChartPeriod } from "@/lib/api/contracts/charts"
import { cn } from "@/lib/utils"
import { periodWords, two } from "./format"

/**
 * Biggest climber and Highest debut (§6.3 "Callouts"), above row 4. Each hides when there is none,
 * and when its subject is already on the podium (where its card shows the same move), so a short
 * board never repeats its own #1. They sit side by side, phones included; on phones the rank and
 * mark make room so the name can take two lines instead of being cut off.
 */
export function Callouts({ callouts, period }: { callouts: ChartBoardDto["callouts"]; period: ChartPeriod }) {
  const up = callouts.biggestClimber && callouts.biggestClimber.rank > 3 ? callouts.biggestClimber : undefined
  const debut = callouts.highestDebut && callouts.highestDebut.rank > 3 ? callouts.highestDebut : undefined
  if (!up && !debut) return null
  const w = periodWords[period]
  return (
    <div className={cn("grid gap-3", up && debut ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2")}>
      {up ? (
        <Callout
          entry={up}
          icon={<ArrowUpRightIcon weight="bold" className="size-3.5" aria-hidden />}
          heading="Biggest climber"
          line={
            <>
              Up {up.delta} to <span className="text-ink">#{up.rank}</span>
              <span className="max-sm:hidden">, from #{up.prevRank} {w.prevLower}</span>
            </>
          }
        />
      ) : null}
      {debut ? <Callout entry={debut} icon={<SparkleIcon weight="fill" className="size-3.5" aria-hidden />} heading="Highest debut" line={<>New at <span className="text-ink">#{debut.rank}</span></>} /> : null}
    </div>
  )
}

function Callout({ entry: e, icon, heading, line }: { entry: ChartEntryDto; icon: React.ReactNode; heading: string; line: React.ReactNode }) {
  const href = e.drop ? `/drops/${e.drop.slug}` : `/brands/${e.brand.handle}`
  return (
    <div className="relative flex min-w-0 items-center gap-3 rounded-lg border border-line-soft bg-card p-3 transition-colors hover:border-white/12 md:gap-4 md:p-4">
      <span className="font-display text-[2.5rem] leading-none text-ink tabular max-sm:hidden" aria-hidden>
        {two(e.rank)}
      </span>
      <BrandMark brand={e.brand} size="sm" className="shrink-0 max-sm:hidden md:size-10" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-ink-2">
          <span className="text-ink">{icon}</span>
          {heading}
        </p>
        <Link href={href} className="line-clamp-2 text-sm leading-snug font-medium text-ink outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-violet sm:line-clamp-1">
          {e.drop ? e.drop.name : e.brand.name}
        </Link>
        <p className="text-xs text-ink-2 tabular sm:truncate">{line}</p>
      </div>
    </div>
  )
}
