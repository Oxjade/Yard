import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"

/**
 * Units left of the run, as a thin bar. Acid only when a run is nearly gone (a fifth or less),
 * so the signal means something; otherwise the bar stays violet (white on a purple surface).
 */
export function StockBar({
  drop,
  tone = "default",
  className,
}: {
  drop: Pick<Drop, "unitsLeft" | "totalUnits">
  tone?: "default" | "purple"
  className?: string
}) {
  const ratio = drop.totalUnits > 0 ? Math.max(0, Math.min(1, drop.unitsLeft / drop.totalUnits)) : 0
  const low = ratio <= 0.2
  const onPurple = tone === "purple"
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className={cn("tabular", low ? "text-acid" : "text-ink")}>
          {drop.unitsLeft} of {drop.totalUnits} left
        </span>
        <span className={onPurple ? "text-ink/75" : "text-ink-2"}>{low ? "Going fast" : `${Math.round(ratio * 100)}% left`}</span>
      </div>
      <div
        className={cn("mt-2 h-1 overflow-hidden rounded-full", onPurple ? "bg-obsidian/35" : "bg-line")}
        role="meter"
        aria-label="Units left"
        aria-valuemin={0}
        aria-valuemax={drop.totalUnits}
        aria-valuenow={drop.unitsLeft}
        aria-valuetext={`${drop.unitsLeft} of ${drop.totalUnits} left`}
      >
        <div className={cn("h-full rounded-full", low ? "bg-acid" : onPurple ? "bg-ink" : "bg-violet")} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}
