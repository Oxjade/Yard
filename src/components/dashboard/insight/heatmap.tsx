"use client"

import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { longDate, shortDate, type HeatCell } from "./derive"

/**
 * Five steps, from a hairline grey through purple to violet. The low steps stay dark so the
 * grid reads as mostly near-black with a few lit days. Acid is kept for the single peak day.
 */
const levels = ["bg-line-soft", "bg-purple/20", "bg-purple/45", "bg-purple", "bg-violet"]
const levelNames = ["None", "Low", "Medium", "High", "Highest"]

/**
 * Weekday × week heatmap: one square per day, five intensity steps, acid for the single peak
 * day (only when one day stands alone). When no day has more than four, the step is the count
 * itself (1 to 4), so a quiet brand still uses the in-between steps. Otherwise steps are ranks
 * among the days that had any activity (the quieter half low, the busiest tenth highest), so a
 * busy marketplace reads as mostly calm with a few highlights. Hover a square, or focus the
 * grid and use the arrow keys, to read that day's count. Three summary stats sit underneath.
 * Pass `ready={false}` while the counts depend on client-only state: the same grid then
 * renders as skeleton squares, so nothing moves on arrival.
 */
export function Heatmap({
  rows,
  columns,
  cells,
  unit,
  label,
  stats,
  ready = true,
  className,
}: {
  rows: readonly string[]
  /** The Monday of each week column. */
  columns: string[]
  cells: HeatCell[][]
  /** "3 orders" from 3. */
  unit: (n: number) => string
  label: string
  stats: { label: string; value: React.ReactNode }[]
  /** False until the counts are known (they come from client-only state). */
  ready?: boolean
  className?: string
}) {
  const flat = cells.flat()
  const data = flat.filter((c) => c.state === "data")
  const max = Math.max(0, ...data.map((c) => c.value))
  const atMax = max ? data.filter((c) => c.value === max) : []
  const peak = atMax.length === 1 ? atMax[0] : null
  const active = data.filter((c) => c.value > 0).map((c) => c.value)

  const find = (pred: (c: HeatCell) => boolean) => {
    for (let c = columns.length - 1; c >= 0; c--) for (let r = rows.length - 1; r >= 0; r--) if (pred(cells[r][c])) return { r, c }
    return { r: 0, c: 0 }
  }
  // Open on the peak day, or on the latest of the days tied for the most.
  const start = peak ? find((c) => c.date === peak.date) : max ? find((c) => c.state === "data" && c.value === max) : find((c) => c.state === "data")
  const [focus, setFocus] = useState(start)
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  const refs = useRef<Record<string, HTMLDivElement | null>>({})
  const shown = hover ?? focus
  const cur = cells[shown.r]?.[shown.c]
  const every = columns.length > 8 ? 4 : 2
  const template = `1.75rem repeat(${columns.length}, minmax(0, 1fr))`

  function step(v: number) {
    if (v <= 0 || !active.length) return 0
    if (max <= 4) return Math.min(4, v)
    const below = active.filter((x) => x < v).length / active.length
    return below < 0.5 ? 1 : below < 0.75 ? 2 : below < 0.9 ? 3 : 4
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const d = ({ ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] } as Record<string, [number, number]>)[e.key]
    const jump = e.key === "Home" ? { r: focus.r, c: 0 } : e.key === "End" ? { r: focus.r, c: columns.length - 1 } : null
    if (!d && !jump) return
    e.preventDefault()
    const next = jump ?? { r: Math.min(rows.length - 1, Math.max(0, focus.r + d![0])), c: Math.min(columns.length - 1, Math.max(0, focus.c + d![1])) }
    setFocus(next)
    setHover(null)
    refs.current[`${next.r}-${next.c}`]?.focus()
  }

  return (
    <div className={cn("@container min-w-0", className)}>
      {/* The readout and the legend share a line only when the card is wide enough for both;
          narrower, they always take two lines. Either way the height never depends on the text. */}
      <div className="grid gap-y-2 @md:flex @md:items-center @md:justify-between @md:gap-x-4">
        <p className="min-h-5 min-w-0 truncate text-[12px]" aria-live="polite">
          {!ready ? (
            <span aria-hidden className="skeleton inline-block h-3 w-40 rounded align-middle" />
          ) : cur ? (
            cur.state === "data" ? (
              <>
                <span className="text-ink-3">{longDate(cur.date)}</span> <span className="font-medium text-ink tabular">{unit(cur.value)}</span>
              </>
            ) : (
              <span className="text-ink-3">{cur.state === "future" ? `${longDate(cur.date)} is still to come` : `${longDate(cur.date)} is before the sample history`}</span>
            )
          ) : null}
        </p>
        <div aria-hidden className="flex h-5 shrink-0 items-center gap-1 text-[11px] text-ink-3">
          <span className="mr-0.5">Low</span>
          {levels.map((l) => (
            <span key={l} className={cn("size-2.5 rounded-[3px]", l)} />
          ))}
          <span className="ml-0.5">High</span>
        </div>
      </div>

      <div aria-hidden className="mt-3 grid gap-[3px]" style={{ gridTemplateColumns: template }}>
        <span />
        {columns.map((col, c) => (
          <span key={col} className={cn("flex h-4 text-[10.5px] leading-4 whitespace-nowrap text-ink-3 tabular", c === columns.length - 1 && "justify-end")}>
            {(columns.length - 1 - c) % every === 0 ? shortDate(col) : ""}
          </span>
        ))}
      </div>

      <div
        role={ready ? "grid" : undefined}
        aria-label={ready ? `${label}. Use the arrow keys to move between days.` : undefined}
        aria-hidden={ready ? undefined : true}
        className="mt-1 grid gap-[3px]"
        onKeyDown={ready ? onKeyDown : undefined}
        onPointerLeave={() => setHover(null)}
      >
        {rows.map((row, r) => (
          <div key={row} role={ready ? "row" : undefined} className="grid items-center gap-[3px]" style={{ gridTemplateColumns: template }}>
            <span role={ready ? "rowheader" : undefined} className="text-[11px] leading-none text-ink-3">
              {row}
            </span>
            {cells[r].map((cell, c) => {
              const on = ready && shown.r === r && shown.c === c
              const isPeak = !!peak && cell.date === peak.date
              const lvl = cell.state === "data" ? step(cell.value) : 0
              const tone = !ready
                ? "skeleton"
                : cell.state === "future"
                  ? "border border-dashed border-white/[0.09]"
                  : cell.state === "before"
                    ? "bg-white/[0.015]"
                    : isPeak
                      ? "bg-acid"
                      : levels[lvl]
              return (
                <div
                  key={cell.date}
                  ref={(el) => {
                    refs.current[`${r}-${c}`] = el
                  }}
                  role={ready ? "gridcell" : undefined}
                  tabIndex={ready ? (focus.r === r && focus.c === c ? 0 : -1) : undefined}
                  aria-label={
                    ready
                      ? `${longDate(cell.date)}: ${cell.state === "data" ? `${unit(cell.value)}${isPeak ? ", the busiest day" : cell.value > 0 ? `, ${levelNames[lvl].toLowerCase()}` : ""}` : cell.state === "future" ? "still to come" : "before the sample history"}`
                      : undefined
                  }
                  onPointerEnter={ready ? () => setHover({ r, c }) : undefined}
                  onFocus={() => setFocus({ r, c })}
                  className={cn(
                    "aspect-[4/3] max-h-7 w-full rounded-[4px] outline-offset-1 transition-[outline-color] duration-150 focus-visible:outline-2 focus-visible:outline-violet",
                    tone,
                    on ? "outline-1 outline-ink" : "outline-1 outline-transparent",
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] px-3 py-2.5">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="truncate text-[11px] text-ink-3">{s.label}</dt>
            {/* Two lines are held while the columns are narrow, so a value that wraps never moves the card. */}
            <dd className="mt-1 min-h-[2.3rem] text-[13px] leading-snug font-medium text-ink tabular @lg:min-h-[1.15rem]">
              {ready ? s.value : <span aria-hidden className="skeleton inline-block h-3.5 w-14 rounded align-middle" />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** A small acid square to mark the peak day in a stat. */
export function PeakSwatch() {
  return <span aria-hidden className="mr-1.5 inline-block size-2 rounded-[2px] bg-acid align-middle" />
}
