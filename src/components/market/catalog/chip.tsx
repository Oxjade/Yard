"use client"

import { useLayoutEffect, useRef } from "react"
import { motion } from "motion/react"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * A pill-shaped filter chip. Selected = purple fill.
 *
 * - Multi-select chips, and single-select rows where nothing has to be chosen (price band,
 *   brand country), are toggle buttons (aria-pressed): each is its own tab stop and a second
 *   click clears it.
 * - A row where exactly one option is always chosen (category, subcategory, sort) is a radio
 *   group: wrap it in <ChipRadioGroup> and pass `radio`. The group is one tab stop (the checked
 *   chip), and the arrow keys, Home and End move the choice. Pass `layoutId` so the fill slides
 *   between chips instead of jumping.
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
  /** One option of a <ChipRadioGroup>: role="radio" with aria-checked and a roving tab stop. */
  radio?: boolean
  size?: "sm" | "default"
  disabled?: boolean
  className?: string
  "aria-label"?: string
}) {
  return (
    <button
      type="button"
      {...(radio ? { role: "radio", "aria-checked": selected, tabIndex: selected ? 0 : -1 } : { "aria-pressed": selected })}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative isolate inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border whitespace-nowrap transition-[color,border-color,background-color,transform,scale] duration-150 ease-out-quint active:scale-[0.97] active:duration-100 disabled:pointer-events-none disabled:opacity-40",
        // Phones get 40px targets; the desktop panel keeps the denser rhythm, and a touch screen
        // that wide still gets a 40px tap from an invisible extension (inside the 1px border).
        size === "sm"
          ? "h-10 min-w-10 px-3 text-[0.8125rem] lg:h-8 lg:pointer-coarse:after:absolute lg:pointer-coarse:after:inset-x-0 lg:pointer-coarse:after:-inset-y-[5px]"
          : "h-10 px-3.5 text-sm lg:h-9 lg:pointer-coarse:after:absolute lg:pointer-coarse:after:inset-x-0 lg:pointer-coarse:after:-inset-y-[3px]",
        selected
          ? cn("border-purple text-ink", !layoutId && "bg-purple")
          : "border-line text-ink-2 hover:border-violet/50 hover:text-ink",
        className,
      )}
    >
      {selected && layoutId ? (
        <motion.span layoutId={layoutId} aria-hidden className="absolute inset-[-1px] -z-10 rounded-full bg-purple" transition={spring.indicator} />
      ) : null}
      {children}
      {count !== undefined ? <span className={cn("tabular text-xs", selected ? "text-ink/75" : "text-ink-3")}>{count}</span> : null}
    </button>
  )
}

const NEXT = new Set(["ArrowRight", "ArrowDown"])
const PREV = new Set(["ArrowLeft", "ArrowUp"])

/**
 * A single-select row of <Chip radio> options, following the ARIA radio group pattern:
 * Tab reaches the checked chip only (the first, when none is checked); Arrow keys move to the next or previous chip and choose
 * it (wrapping around); Home and End choose the first and last. Disabled chips are skipped.
 */
export function ChipRadioGroup({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  // Chips set their own roving tabIndex. With nothing checked (a choice the URL no longer
  // matches, say) every chip would be -1 and Tab would skip the group, so after each render the
  // first enabled chip takes the tab stop, and any it held before goes back to -1.
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const radios = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
    const checked = radios.some((r) => r.getAttribute("aria-checked") === "true" && !r.disabled)
    radios.forEach((r) => {
      if (r.getAttribute("aria-checked") !== "true") r.tabIndex = -1
    })
    if (!checked) {
      const first = radios.find((r) => !r.disabled)
      if (first) first.tabIndex = 0
    }
  })

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!NEXT.has(e.key) && !PREV.has(e.key) && e.key !== "Home" && e.key !== "End") return
    const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')]
    const current = radios.indexOf(document.activeElement as HTMLButtonElement)
    if (current === -1 || radios.length === 0) return
    e.preventDefault()
    const target =
      e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1 : NEXT.has(e.key) ? (current + 1) % radios.length : (current - 1 + radios.length) % radios.length
    const next = radios[target]
    next.focus()
    next.scrollIntoView({ block: "nearest", inline: "nearest" })
    if (next.getAttribute("aria-checked") !== "true") next.click()
  }

  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={className}>
      {children}
    </div>
  )
}
