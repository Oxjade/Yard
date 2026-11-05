"use client"

import { useEffect } from "react"
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react"
import { ArrowDownRightIcon as ArrowDownRight, ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/** A number that eases to its new value when the period changes. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => format(v))
  useEffect(() => {
    if (reduce) {
      mv.set(value)
      return
    }
    const controls = animate(mv, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1] })
    return () => controls.stop()
  }, [value, mv, reduce])
  return <motion.span>{text}</motion.span>
}

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
  const up = (delta ?? 0) >= 0
  return (
    <div className={cn("relative rounded-lg border border-line-soft bg-card", density === "dense" ? "p-3" : "p-4", highlight && "border-acid/30", className)}>
      <p className={cn("text-ink-2", density === "dense" ? "text-[11px]" : "text-xs")}>{label}</p>
      <p className={cn("mt-2 font-medium tracking-tight text-ink tabular", density === "dense" ? "text-lg" : "text-2xl")}>
        <AnimatedNumber value={value} format={format} />
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
        {delta !== undefined && delta !== null ? (
          <span className={cn("inline-flex items-center gap-0.5 tabular", up ? "text-violet" : "text-danger")}>
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(delta * 100).toFixed(1)}%
          </span>
        ) : null}
        {hint ? <span className="text-ink-3">{hint}</span> : null}
      </div>
    </div>
  )
}
