"use client"

import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { ChartEntryDto } from "@/lib/api/contracts/charts"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { movementWords } from "./format"

/**
 * The movement chip (§6.3 "RankMove"): ▲n purple, ▼n red, "—" for no change, "New" and "Re-entry"
 * spelled out. When an edition refresh changes the movement, the new chip slides in from the
 * direction it moved (up from below, down from above); reduced motion swaps it in place.
 */
export function RankMove({ entry, size = "md", className }: { entry: Pick<ChartEntryDto, "movement" | "delta">; size?: "sm" | "md"; className?: string }) {
  const reduce = useReducedMotion()
  const key = `${entry.movement}:${entry.delta}`
  const from = entry.movement === "up" ? 6 : entry.movement === "down" ? -6 : 0
  const label = movementWords(entry)
  const h = size === "sm" ? "h-6 text-[11px]" : "h-7 text-xs"

  let chip: React.ReactNode
  if (entry.movement === "new") chip = <StatusBadge tone="info" className={size === "sm" ? undefined : "h-7"}>New</StatusBadge>
  else if (entry.movement === "reentry") chip = <StatusBadge tone="neutral" className={size === "sm" ? undefined : "h-7"}>Re-entry</StatusBadge>
  else
    chip = (
      <span
        className={cn(
          "inline-flex min-w-9 items-center justify-center gap-0.5 rounded-[5px] px-1.5 font-medium tabular",
          h,
          entry.movement === "up" ? "bg-purple/15 text-violet" : entry.movement === "down" ? "bg-danger/12 text-danger" : "bg-white/[0.06] text-ink-2",
        )}
      >
        {entry.movement === "up" ? <CaretUpIcon weight="fill" className="size-3" aria-hidden /> : entry.movement === "down" ? <CaretDownIcon weight="fill" className="size-3" aria-hidden /> : null}
        {entry.movement === "same" ? "—" : Math.abs(entry.delta)}
      </span>
    )

  return (
    <span className={cn("relative inline-flex shrink-0 overflow-hidden", className)} title={label[0].toUpperCase() + label.slice(1)}>
      <span className="sr-only">{label}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={key}
          aria-hidden
          className="inline-flex"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: from }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -from }}
          transition={{ duration: duration.chart, ease: ease.settle }}
        >
          {chip}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
