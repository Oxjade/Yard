"use client"

import { cn } from "@/lib/utils"

export type Period = "today" | "7d" | "30d" | "90d"
export const periodDays: Record<Period, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 }
export const periodLabel: Record<Period, string> = { today: "Today", "7d": "7 days", "30d": "30 days", "90d": "90 days" }

/** Segmented period control. The selected period is purple (a selected control). */
export function PeriodSelect({ value, onChange, className, options = ["today", "7d", "30d", "90d"] }: { value: Period; onChange: (p: Period) => void; className?: string; options?: Period[] }) {
  return (
    <div role="radiogroup" aria-label="Period" className={cn("inline-flex h-9 items-center rounded-md border border-line bg-surface p-0.5", className)}>
      {options.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          onClick={() => onChange(p)}
          className={cn("h-8 rounded-[5px] px-3 text-xs transition-colors", value === p ? "bg-purple text-ink" : "text-ink-2 hover:text-ink")}
        >
          {periodLabel[p]}
        </button>
      ))}
    </div>
  )
}
