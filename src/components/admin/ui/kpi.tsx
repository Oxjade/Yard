"use client"

import { useId } from "react"
import { motion } from "motion/react"
import { ArrowDownRightIcon as ArrowDownRight, ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { AnimatedNumber } from "@/components/dashboard/metric-tile"
import { chartIn } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { RevealItem, springs } from "./motion"

/** A tiny, dependency-free trend line. Fixed size, so it never shifts layout. */
export function Sparkline({ values, className, tone = "purple", height = 36 }: { values: number[]; className?: string; tone?: "purple" | "acid" | "grey"; height?: number }) {
  const id = useId()
  const w = 160
  const h = height
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className={className} style={{ height }} aria-hidden />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 8)] as const)
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const area = `${line} L${w},${h} L0,${h} Z`
  const color = tone === "acid" ? "#f5ff00" : tone === "grey" ? "#858585" : "#9452ff"
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("w-full overflow-visible", className)} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`sl-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0.12" />
        </linearGradient>
        <clipPath id={`clip-${id}`}>
          <motion.rect x="0" y="-4" height={h + 8} initial={{ width: 0 }} animate={{ width: w + 4 }} transition={{ duration: 0.6, ease: chartIn.ease, delay: 0.1 }} />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${id})`}>
        <path d={area} fill={`url(#sl-${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </g>
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  )
}

export function Delta({ value, invert = false, className }: { value: number | null | undefined; invert?: boolean; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const up = value >= 0
  const good = invert ? !up : up
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12px] tabular", good ? "text-violet" : "text-danger", className)}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(value * 100).toFixed(1)}%
    </span>
  )
}

/**
 * Metric card. The number counts up from zero the first time it appears and eases on period
 * change; the card lifts on hover and presses in on click when it links somewhere.
 */
export function KpiCard({
  label,
  value,
  format,
  delta,
  hint,
  spark,
  sparkTone = "purple",
  size = "md",
  attention = false,
  onClick,
  className,
  children,
}: {
  label: string
  value: number
  format: (n: number) => string
  delta?: number | null
  hint?: string
  spark?: number[]
  sparkTone?: "purple" | "acid" | "grey"
  size?: "lg" | "md" | "sm"
  attention?: boolean
  /** @deprecated The corner bloom is gone (no colour glows); the prop is ignored. */
  glow?: boolean
  onClick?: () => void
  className?: string
  children?: React.ReactNode
}) {
  const interactive = !!onClick
  const Comp = interactive ? motion.button : motion.div
  return (
    <RevealItem className={cn("min-w-0", className)}>
      <Comp
        type={interactive ? "button" : undefined}
        onClick={onClick}
        whileHover={{ y: -2 }}
        whileTap={interactive ? { scale: 0.985 } : undefined}
        transition={springs.tactile}
        className={cn(
          "admin-panel group flex h-full w-full flex-col text-left transition-[border-color] duration-300",
          "hover:border-[var(--admin-hairline-strong)]",
          attention && "admin-panel-attention",
          size === "lg" ? "p-5 md:p-6" : size === "md" ? "p-4" : "p-3.5",
          interactive && "cursor-pointer focus-visible:outline-2 focus-visible:outline-violet",
        )}
      >
        <div className="relative flex items-center justify-between gap-2">
          <p className={cn("text-ink-2", size === "lg" ? "text-[13px]" : "text-[12px]")}>{label}</p>
          {attention ? <span className="size-1.5 rounded-full bg-acid" aria-label="Needs attention" /> : null}
        </div>
        <p className={cn("relative mt-3 text-ink font-metric", size === "lg" ? "text-[clamp(2.5rem,4.5vw,3.25rem)]" : size === "md" ? "text-[2rem]" : "text-[1.625rem]")}>
          <AnimatedNumber value={value} format={format} />
        </p>
        <div className="relative mt-2 flex min-h-5 flex-wrap items-center gap-x-2.5 gap-y-1">
          <Delta value={delta} />
          {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
        </div>
        {spark ? <Sparkline values={spark} tone={sparkTone} className="relative mt-auto pt-4" height={size === "lg" ? 96 : 30} /> : null}
        {children ? <div className="relative mt-4">{children}</div> : null}
      </Comp>
    </RevealItem>
  )
}
