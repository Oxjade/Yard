"use client"

import { useId } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"
import { springs } from "./motion"

/** A segmented control whose selection pill slides between options on a spring. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
  label: string
  className?: string
  size?: "sm" | "md"
}) {
  const id = useId()
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex items-center gap-0.5 rounded-[10px] border border-[var(--admin-hairline)] bg-white/[0.02] p-[3px]", className)}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative isolate inline-flex items-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap transition-colors duration-200",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]",
              on ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {on ? <motion.span layoutId={`seg-${id}`} transition={springs.pill} className="absolute inset-0 -z-10 rounded-[7px] bg-purple shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]" /> : null}
            {o.label}
            {o.count !== undefined ? (
              <span className={cn("rounded-[4px] px-1 text-[10.5px] leading-4 tabular", on ? "bg-black/25 text-ink" : o.count > 0 ? "bg-acid text-obsidian" : "bg-white/6 text-ink-3")}>{o.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
