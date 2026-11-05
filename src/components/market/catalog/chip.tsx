"use client"

import { motion } from "motion/react"
import { cn } from "@/lib/utils"

/**
 * A pill-shaped filter chip. Selected = purple fill. In a single-select row pass `radio` (and
 * wrap the row in role="radiogroup") so it is announced as one choice, and `layoutId` so the
 * fill slides between chips instead of jumping. Multi-select chips stay toggles (aria-pressed).
 */
export function Chip({
  selected,
  onClick,
  children,
  count,
  layoutId,
  radio = false,
  size = "default",
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
  layoutId?: string
  /** One option of a single-select group: role="radio" with aria-checked. */
  radio?: boolean
  size?: "sm" | "default"
  disabled?: boolean
  className?: string
  "aria-label"?: string
}) {
  return (
    <button
      type="button"
      {...(radio ? { role: "radio", "aria-checked": selected } : { "aria-pressed": selected })}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border whitespace-nowrap transition-[color,border-color,background-color] duration-200 ease-out-quint disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-8 min-w-10 px-3 text-[0.8125rem]" : "h-9 px-3.5 text-sm",
        selected
          ? cn("border-purple text-ink", !layoutId && "bg-purple")
          : "border-line text-ink-2 hover:border-violet/50 hover:text-ink",
        className,
      )}
    >
      {selected && layoutId ? (
        <motion.span
          layoutId={layoutId}
          aria-hidden
          className="absolute inset-[-1px] -z-10 rounded-full bg-purple"
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
        />
      ) : null}
      {children}
      {count !== undefined ? <span className={cn("tabular text-xs", selected ? "text-ink/75" : "text-ink-3")}>{count}</span> : null}
    </button>
  )
}
