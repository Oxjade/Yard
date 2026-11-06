"use client"

import { useRef } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

/**
 * Saved-view tabs over a list: one per status, each with its count. The active tab carries
 * a purple underline that slides between tabs.
 */
export function StatusTabs<T extends string>({
  id,
  label,
  value,
  onChange,
  tabs,
  controls,
  className,
}: {
  id: string
  label: string
  value: T
  onChange: (v: T) => void
  tabs: { value: T; label: string; count?: number }[]
  /** id of the region the tabs filter */
  controls?: string
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = tabs.length - 1
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null
    if (next === null) return
    e.preventDefault()
    onChange(tabs[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div className={cn("-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0", className)}>
      <div role="tablist" aria-label={label} className="flex min-w-max gap-1 border-b border-line-soft">
        {tabs.map((t, i) => {
          const on = t.value === value
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${id}-${t.value}`}
              aria-selected={on}
              aria-controls={controls}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(t.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn("relative inline-flex h-10 items-center gap-2 rounded-t-md px-3 text-sm outline-none transition-colors focus-visible:bg-white/[0.04]", on ? "text-ink" : "text-ink-2 hover:text-ink")}
            >
              {t.label}
              {t.count !== undefined ? <span className={cn("rounded-[4px] px-1.5 text-[11px] leading-4 tabular", on ? "bg-white/10 text-ink" : "bg-white/[0.05] text-ink-3")}>{t.count}</span> : null}
              {on ? <motion.span layoutId={`${id}-underline`} aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-purple" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
