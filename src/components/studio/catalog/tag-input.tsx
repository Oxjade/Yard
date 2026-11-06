"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { PlusIcon as Plus, XIcon as X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/**
 * Chips plus a text field. Enter or comma adds what's typed; Backspace in an empty field
 * removes the last chip. Values are normalised by `normalise` before they're added.
 */
export function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  max,
  maxLength = 24,
  normalise = (s) => s.trim(),
  suggestions = [],
  invalid,
  describedBy,
  onMessage,
  itemLabel = "tag",
}: {
  id: string
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  max?: number
  maxLength?: number
  normalise?: (s: string) => string
  suggestions?: string[]
  invalid?: boolean
  describedBy?: string
  /** Called with a short reason when a value can't be added, or null when the field is fine again. */
  onMessage?: (message: string | null) => void
  itemLabel?: string
}) {
  const [draft, setDraft] = useState("")
  const full = max !== undefined && values.length >= max

  function add(raw: string) {
    const parts = raw.split(",").map(normalise).filter(Boolean)
    if (!parts.length) return
    const next = [...values]
    for (const v of parts) {
      if (max !== undefined && next.length >= max) {
        onMessage?.(`You can add up to ${max} ${itemLabel}s.`)
        break
      }
      if (v.length > maxLength) {
        onMessage?.(`Keep each ${itemLabel} to ${maxLength} characters or fewer.`)
        continue
      }
      if (next.some((x) => x.toLowerCase() === v.toLowerCase())) {
        onMessage?.(`"${v}" is already added.`)
        continue
      }
      next.push(v)
      onMessage?.(null)
    }
    onChange(next)
    setDraft("")
  }

  const open = suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8)

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:min-h-9 dark:bg-input/30",
          invalid && "border-destructive ring-3 ring-destructive/20",
        )}
        onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
      >
        <AnimatePresence initial={false}>
          {values.map((v) => (
            <motion.span
              key={v}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-white/12 bg-elevated pr-1 pl-2.5 text-xs text-ink"
            >
              {v}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`} className="relative inline-flex size-5 items-center justify-center rounded-full text-ink-3 transition-colors after:absolute after:-inset-2 hover:bg-white/10 hover:text-ink">
                <X className="size-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          id={id}
          value={draft}
          disabled={full}
          onChange={(e) => {
            const v = e.target.value
            if (v.includes(",")) add(v)
            else setDraft(v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add(draft)
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={full ? `${max} ${itemLabel}s added` : values.length ? "" : placeholder}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed md:text-sm"
        />
      </div>
      {open.length && !full ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-3">Suggested</span>
          {open.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-line px-2.5 text-[11px] text-ink-2 transition-colors hover:border-violet/60 hover:text-ink md:h-6 md:px-2">
              <Plus className="size-3" /> {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
