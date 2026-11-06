"use client"

import { useId, useRef } from "react"
import { motion } from "motion/react"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * A single-choice switch (period, bucket size). The selected option is purple and the pill
 * glides between options. It behaves like a radio group: one tab stop, arrow keys move
 * the selection, Home and End jump to the ends.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  size?: "sm" | "md"
  className?: string
}) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = options.length - 1
    const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.02] p-[3px]", className)}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative isolate inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet",
              size === "sm" ? "h-10 px-3.5 text-[12px] sm:h-7 sm:px-3" : "h-10 px-3.5 text-[12.5px] sm:h-8",
              on ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {on ? <motion.span layoutId={`segmented-${id}`} transition={spring.indicator} className="absolute inset-0 -z-10 rounded-full bg-purple shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" /> : null}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
