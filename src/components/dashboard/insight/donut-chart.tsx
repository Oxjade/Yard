"use client"

import { useId, useRef, useState } from "react"
import Link from "next/link"
import { motion, useTransform } from "motion/react"
import { useHydrated } from "@/hooks/use-hydrated"
import { cn } from "@/lib/utils"
import { chartEase, progress, useEntranceClock } from "./clock"
import { CountUp } from "./count-up"
import { useSeen } from "./use-entrance"

/** The ring's sweep on first appearance, in ms. */
const SWEEP = 600

export type DonutSegment = { key: string; label: string; value: number; href?: string }

/** Purple first, then violet, then greys: the largest share reads first. */
const palette = ["#6d19d9", "#9452ff", "#858585", "#5e5e5e", "#3d3d3d"]

/**
 * Donut with a centre total and a legend. Hovering or focusing a legend row (or a segment)
 * brings its share to the centre and dims the rest; rows with an `href` open that record.
 * The first time it is seen, the ring sweeps in clockwise from twelve o'clock and the centre
 * total counts up (not under reduced motion); later changes redraw in place. The sweep runs
 * on its own clock (clock.ts), so a busy main thread delays it rather than skipping it.
 */
export function DonutChart({
  segments,
  format,
  formatFull,
  totalLabel = "Total",
  label,
  empty = "Nothing to show for this period.",
  emptyCentre = "Nothing yet",
  size = 168,
  className,
}: {
  segments: DonutSegment[]
  /** Compact format for the centre. */
  format: (n: number) => string
  formatFull: (n: number) => string
  totalLabel?: string
  /** What the donut shows, for screen readers. */
  label: string
  empty?: string
  /** Short words for the centre when there is nothing to show ("No sales"). */
  emptyCentre?: string
  size?: number
  className?: string
}) {
  const hydrated = useHydrated()
  const ring = useRef<HTMLDivElement>(null)
  const inView = useSeen(ring)
  const clock = useEntranceClock(inView, SWEEP)
  const sweep = useTransform(clock, (t) => chartEase(progress(t, SWEEP)))
  const mask = `donut-sweep-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const [active, setActive] = useState<string | null>(null)
  const total = segments.reduce((s, x) => s + x.value, 0)
  const stroke = 18
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0
  const cur = segments.find((s) => s.key === active) ?? null
  const share = (v: number) => (total ? v / total : 0)
  const pct = (v: number) => (v > 0 && share(v) < 0.005 ? "<1%" : `${Math.round(share(v) * 100)}%`)

  let acc = 0
  const arcs = segments.map((s, i) => {
    const len = Math.max(0, share(s.value) * c - gap)
    const arc = { ...s, color: palette[Math.min(i, palette.length - 1)], dash: `${len} ${c - len}`, offset: -(acc * c + gap / 2) }
    acc += share(s.value)
    return arc
  })

  return (
    <div className={cn("@container min-w-0", className)}>
      <div className="flex flex-col items-center gap-5 @[21rem]:flex-row @[21rem]:items-center">
        <div ref={ring} className="relative shrink-0" style={{ width: size, height: size }}>
          {!hydrated ? (
            <div key="skeleton" aria-hidden className="skeleton size-full rounded-full [mask:radial-gradient(circle,transparent_55%,#000_56%)]" />
          ) : (
            <svg key="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}. ${total ? arcs.map((a) => `${a.label} ${pct(a.value)}`).join(", ") : empty}`}>
              <defs>
                {/* The sweep: a mask ring that draws itself once, revealing every segment in turn. */}
                <mask id={mask} maskUnits="userSpaceOnUse" x={0} y={0} width={size} height={size}>
                  <motion.circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={stroke + 2}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    style={{ pathLength: sweep }}
                  />
                </mask>
              </defs>
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke} />
              <g mask={`url(#${mask})`}>
                <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                  {total
                    ? arcs.map((a) =>
                        a.value > 0 ? (
                          <circle
                            key={a.key}
                            cx={size / 2}
                            cy={size / 2}
                            r={r}
                            fill="none"
                            stroke={a.color}
                            strokeWidth={stroke}
                            strokeDasharray={a.dash}
                            strokeDashoffset={a.offset}
                            className={cn("transition-opacity duration-150", cur && cur.key !== a.key ? "opacity-25" : "opacity-100")}
                            onPointerEnter={() => setActive(a.key)}
                            onPointerLeave={() => setActive(null)}
                          />
                        ) : null,
                      )
                    : null}
                </g>
              </g>
            </svg>
          )}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {hydrated ? (
              total || cur ? (
                <span key="ready" className="flex flex-col items-center">
                  {/* The total stays mounted under a hovered share, so it counts once, not on every hover. */}
                  <span className="font-metric inline-grid justify-items-center text-[1.625rem] text-ink [&>*]:[grid-area:1/1]">
                    <span className={cn(cur && "invisible")}>{total ? <CountUp value={total} format={format} /> : format(0)}</span>
                    {cur ? <span>{format(cur.value)}</span> : null}
                  </span>
                  <span className="mt-1.5 max-w-[7.5rem] truncate text-[11px] text-ink-3">{cur ? `${pct(cur.value)} of ${totalLabel.toLowerCase()}` : totalLabel}</span>
                </span>
              ) : (
                <span key="empty" className="max-w-[7.5rem] text-[13px] text-ink-3">{emptyCentre}</span>
              )
            ) : (
              <span key="loading" className="flex flex-col items-center">
                <span className="skeleton h-6 w-16 rounded-md" />
                <span className="skeleton mt-2 h-3 w-10 rounded" />
              </span>
            )}
          </div>
        </div>

        <ul className="grid w-full min-w-0 gap-0.5 @[21rem]:flex-1" onPointerLeave={() => setActive(null)}>
          {!hydrated ? (
            segments.map((s) => (
              <li key={s.key} aria-hidden className="flex h-10 items-center gap-2.5 px-2 sm:h-9">
                <span className="skeleton size-2.5 shrink-0 rounded-[3px]" />
                <span className="skeleton h-3 flex-1 rounded" />
                <span className="skeleton h-3 w-7 shrink-0 rounded" />
              </li>
            ))
          ) : total ? (
            arcs.map((a) => {
              const inner = (
                <>
                  <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: a.color }} />
                  <span className="min-w-0 flex-1 truncate text-ink-2 transition-colors group-hover/leg:text-ink group-focus-visible/leg:text-ink">{a.label}</span>
                  <span className="shrink-0 text-ink tabular">{pct(a.value)}</span>
                </>
              )
              const rowClass = cn(
                "group/leg flex h-10 w-full sm:h-9 items-center gap-2.5 rounded-lg px-2 text-left text-[12.5px] transition-[background-color,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-violet",
                active === a.key ? "bg-white/[0.04]" : "",
                cur && cur.key !== a.key ? "opacity-60" : "",
              )
              // A row with a destination is a link; a row without one (such as "Other") is
              // plain text with its full value for screen readers, and no tab stop of its own.
              return (
                <li key={a.key}>
                  {a.href ? (
                    <Link
                      href={a.href}
                      onPointerEnter={() => setActive(a.key)}
                      onFocus={() => setActive(a.key)}
                      onBlur={() => setActive(null)}
                      aria-label={`${a.label}: ${formatFull(a.value)}, ${pct(a.value)} of ${totalLabel.toLowerCase()}`}
                      className={rowClass}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div onPointerEnter={() => setActive(a.key)} className={rowClass}>
                      {inner}
                      <span className="sr-only">, {formatFull(a.value)}</span>
                    </div>
                  )}
                </li>
              )
            })
          ) : (
            <li className="px-2 text-center text-[12.5px] text-ink-3 @[21rem]:text-left">{empty}</li>
          )}
        </ul>
      </div>
    </div>
  )
}
