"use client"

import { cn } from "@/lib/utils"
import { ArrowLink } from "./arrow-link"
import { CountUp } from "./count-up"
import { DeltaChip } from "./delta-chip"
import { surfaceClass } from "./insight-panel"

type Variant = "default" | "brand" | "acid"

/**
 * KPI card: small icon and tracked label, a round arrow to the detail page, a big numeral
 * that counts up on first view, and the change against the previous period.
 * `brand` (purple) and `acid` fills are for the single most important card of each kind
 * on a page. Until `ready`, a same-size skeleton holds the numeral's place (and the change
 * chip waits), so a figure that is still loading never reads as 0.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  format,
  delta,
  deltaContext,
  hint,
  href,
  hrefLabel,
  variant = "default",
  surface = "studio",
  ready = true,
  className,
}: {
  icon: React.ComponentType<{ className?: string; weight?: "regular" | "fill" | "bold"; "aria-hidden"?: boolean }>
  label: string
  value: number
  format: (n: number) => string
  delta?: number | null
  deltaContext?: string
  hint?: React.ReactNode
  href: string
  hrefLabel?: string
  variant?: Variant
  surface?: "studio" | "admin"
  ready?: boolean
  className?: string
}) {
  const filled = variant !== "default"
  const on = variant === "acid" ? "acid" : variant === "brand" ? "brand" : "dark"
  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-col p-4 md:p-5",
        variant === "acid"
          ? "rounded-[20px] bg-acid text-obsidian"
          : variant === "brand"
            ? "rounded-[20px] bg-purple text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
            : surface === "admin"
              ? "admin-panel rounded-[20px]"
              : surfaceClass,
        className,
      )}
    >
      {/* The label may wrap to a second, balanced line. Two 14px lines are exactly the arrow's
          28px, so a card whose label wraps is no taller than its neighbours in the row. */}
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h3 className={cn("font-label flex min-w-0 items-center gap-2 text-[11px] tracking-[0.1em] uppercase", filled ? (variant === "acid" ? "text-obsidian/70" : "text-ink/80") : "text-ink-3")}>
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="line-clamp-2 leading-[14px] text-balance">{label}</span>
        </h3>
        <ArrowLink href={href} label={hrefLabel ?? `Open ${label.toLowerCase()}`} on={on} />
      </div>
      <div className="mt-5 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
        {ready ? (
          <p className="font-metric text-[2.25rem] leading-none md:text-[2.5rem]">
            <CountUp value={value} format={format} />
          </p>
        ) : (
          <span aria-hidden className={cn("block h-9 w-28 rounded-md md:h-10", filled ? "bg-black/10" : "skeleton")} />
        )}
        {ready ? <DeltaChip value={delta} on={on} context={deltaContext} /> : null}
      </div>
      {hint ? <p className={cn("mt-2 truncate text-[12px]", variant === "acid" ? "text-obsidian/65" : filled ? "text-ink/75" : "text-ink-3")}>{hint}</p> : null}
    </article>
  )
}
