"use client"

import { useId, useRef } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { springs } from "./motion"

/** The id of the tab for `value` in a Segmented given `idBase`, for a tabpanel's aria-labelledby. */
export const segmentedTabId = (idBase: string, value: string) => `${idBase}-tab-${value}`

/**
 * A tab switch whose selection pill slides between options on a spring. It follows the ARIA
 * tabs pattern: one tab stop, the arrow keys move the selection, Home and End jump to the
 * ends. Pass `idBase` and `panelId` to link each tab to the panel it controls.
 *
 * Counts: an "attention" count above zero is acid, for work waiting on a person (a queue,
 * flagged items). A "neutral" count is grey, for plain totals that need nothing (unread,
 * all records). Set the tone for the whole switch with `countTone`, or per option.
 */
export type CountTone = "attention" | "neutral"

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
  countTone = "attention",
  loading = false,
  idBase,
  panelId,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number; countTone?: CountTone }[]
  label: string
  className?: string
  size?: "sm" | "md"
  /** How counts read when an option doesn't set its own tone. Defaults to "attention". */
  countTone?: CountTone
  /** Counts are not known yet (before hydration): a same-size placeholder stands in, never a 0. */
  loading?: boolean
  /** Prefix for the tab ids (see segmentedTabId). */
  idBase?: string
  /** The id of the tabpanel the tabs control. */
  panelId?: string
}) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = options.length - 1
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-full border border-[var(--admin-hairline)] bg-white/[0.02] p-[3px]", className)}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            id={idBase ? segmentedTabId(idBase, o.value) : undefined}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={on ? panelId : undefined}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative isolate inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet",
              size === "sm" ? "h-10 px-3 text-[12px] sm:h-7 sm:px-2.5" : "h-10 px-3 text-[12.5px] sm:h-8",
              on ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {on ? <motion.span layoutId={`seg-${id}`} transition={springs.pill} className="absolute inset-0 -z-10 rounded-full bg-purple shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" /> : null}
            {o.label}
            {o.count !== undefined && loading ? (
              <span aria-hidden className="skeleton inline-block h-4 w-4 rounded-full" />
            ) : o.count !== undefined ? (
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10.5px] leading-none tabular",
                  on ? "bg-black/25 text-ink" : o.count > 0 && (o.countTone ?? countTone) === "attention" ? "border border-acid/40 text-acid" : o.count > 0 ? "border border-white/10 text-ink-2" : "border border-white/10 text-ink-3",
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
