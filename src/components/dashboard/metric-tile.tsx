"use client"

import { CountUp } from "@/components/dashboard/insight/count-up"
import { DeltaChip } from "@/components/dashboard/insight/delta-chip"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { cn } from "@/lib/utils"

/**
 * A metric number: counts up from zero the first time it appears, then eases to its new
 * value when the period changes. A thin wrapper over CountUp, kept for its callers.
 */
export function AnimatedNumber({ value, format, updates }: { value: number; format: (n: number) => string; updates?: "ease" | "instant" }) {
  return <CountUp value={value} format={format} updates={updates} />
}

/**
 * A compact figure for Studio index pages (Promotions, Drops, Advertising), drawn like the
 * Overview's StatCard: the same surface, tracked label, condensed numeral and change chip,
 * without the icon and the link. The hint wraps rather than cutting off on narrow tiles.
 */
export function MetricTile({
  label,
  value,
  format,
  delta,
  hint,
  className,
  density = "comfortable",
  highlight = false,
}: {
  label: string
  value: number
  format: (n: number) => string
  /** Change vs the previous period, as a ratio. */
  delta?: number | null
  hint?: string
  className?: string
  density?: "comfortable" | "dense"
  highlight?: boolean
}) {
  const dense = density === "dense"
  return (
    <div className={cn(surfaceClass, "relative flex min-w-0 flex-col", dense ? "p-3 md:p-4" : "p-4 md:p-5", highlight && "border-acid/30", className)}>
      {/* Two 14px lines fit the 28px row, so a tile whose label wraps keeps its numeral level with its neighbours'. */}
      <p className="font-label flex min-h-7 items-center text-[11px] tracking-[0.1em] text-ink-3 uppercase">
        <span className="line-clamp-2 leading-[14px] text-balance">{label}</span>
      </p>
      <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", dense ? "mt-2" : "mt-4")}>
        <p className={cn("font-metric leading-none text-ink", dense ? "text-[1.5rem]" : "text-[1.875rem] md:text-[2.125rem]")}>
          <AnimatedNumber value={value} format={format} />
        </p>
        <DeltaChip value={delta} size={dense ? "sm" : "md"} />
      </div>
      {hint ? <p className={cn("text-[12px] leading-snug text-pretty text-ink-3", dense ? "mt-1.5" : "mt-2")}>{hint}</p> : null}
    </div>
  )
}
