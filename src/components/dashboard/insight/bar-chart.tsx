"use client"

import { useEffect, useId, useRef, useState } from "react"
import { motion, useTransform, type HTMLMotionProps, type MotionValue } from "motion/react"
import { useHydrated } from "@/hooks/use-hydrated"
import { chartIn, spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { chartEase, progress, useEntranceClock } from "./clock"
import { DeltaChip } from "./delta-chip"
import { useSeen } from "./use-entrance"

export type BarDatum = {
  key: string
  /** Short x-axis label. */
  label: string
  /** What the bar covers, in words ("12 Oct to 18 Oct"). */
  fullLabel: string
  value: number
  /** Change against the bucket before; null when there is none to compare with. */
  delta?: number | null
  /** A secondary fact shown in the readout ("8 orders"). */
  meta?: string
}

/** Head room above the tallest bar for the highlight chip. */
const CHIP_SPACE = 34
const AXIS_W = 44

const hatch =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Cpath d='M-2 2l4-4M0 8l8-8M6 10l4-4' stroke='%23ffffff' stroke-opacity='0.075' stroke-width='1'/%3E%3C/svg%3E\")"

function niceTicks(max: number) {
  if (max <= 0) return { top: 1, ticks: [0] }
  const raw = max / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
  const n = Math.max(1, Math.ceil(max / step))
  return { top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) }
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/** Rough width of an 11px tabular axis label, to decide how many labels fit. */
const labelWidth = (text: string) => text.length * 6.2 + 8

/** The entrance, in ms: each bar grows for `grow`, starting up to `stagger` after the first;
    the value chip and the in-bar label then fade in over `label`. */
const entrance = { grow: chartIn.duration * 1000, stagger: chartIn.stagger * 1000, label: 150 }

/** A bar that grows from the baseline as the entrance clock runs. */
function GrowBar({ clock, delay, style, ...props }: HTMLMotionProps<"span"> & { clock: MotionValue<number>; delay: number }) {
  const scaleY = useTransform(clock, (t) => chartEase(progress(t, entrance.grow, delay)))
  return <motion.span {...props} style={{ ...style, scaleY }} />
}

/**
 * Hatched bar chart with one highlighted bar (purple: the selected one), the latest by default. Hover, focus
 * or the arrow keys move the highlight; on touch, tapping or sliding a finger across the
 * plot does (the whole plot is the target, so narrow bars stay easy to hit). The readout
 * above the plot names the bar on two fixed lines. Bars grow from the baseline the first
 * time the chart is seen, with a short stagger spread over the series; the value chip and
 * the in-bar label fade in once the bars have grown (not under reduced motion, where the
 * chart is drawn in full). The entrance runs on its own clock (clock.ts), so a busy main
 * thread delays it rather than skipping it. Remount it with a new `key` when the buckets
 * change so the bars grow again.
 */
export function BarChart({
  data,
  format,
  formatFull,
  height = 240,
  label,
  deltaContext = "the bar before",
  className,
}: {
  data: BarDatum[]
  /** Compact format for ticks and the in-bar label. */
  format: (n: number) => string
  /** Full format for the readout and screen readers. */
  formatFull: (n: number) => string
  height?: number
  /** What the chart shows, for screen readers ("Revenue by week"). */
  label: string
  deltaContext?: string
  className?: string
}) {
  const id = useId()
  const hydrated = useHydrated()
  const last = data.length - 1
  // The latest bar by default; when the latest bucket is still empty (a day that has only
  // just begun), the latest bar that has something to show.
  const initial = (() => {
    for (let i = last; i >= 0; i--) if (data[i].value > 0) return i
    return last
  })()
  const [selected, setSelected] = useState(initial)
  const [hover, setHover] = useState<number | null>(null)
  const active = Math.min(hover ?? selected, last)
  const bars = useRef<(HTMLButtonElement | null)[]>([])
  const group = useRef<HTMLDivElement>(null)
  // A touch already selected its bar on pointer down; the click that follows is ignored.
  const touched = useRef(false)
  const [plotRef, plotW] = useWidth<HTMLDivElement>()
  const inView = useSeen(plotRef, "0px 0px -10% 0px")
  const grown = entrance.grow + (data.length > 1 ? entrance.stagger : 0)
  const clock = useEntranceClock(inView, grown + entrance.label)
  const labelOpacity = useTransform(clock, [grown, grown + entrance.label], [0, 1])

  const max = Math.max(0, ...data.map((d) => d.value))
  const { top, ticks } = niceTicks(max)
  const areaH = height - CHIP_SPACE
  const slotW = plotW ? plotW / Math.max(1, data.length) : 0
  const barW = Math.min(slotW * 0.72, 52)
  // Room for the longest label between shown labels.
  const room = Math.max(54, ...data.map((d) => labelWidth(d.label)))
  const step = slotW ? Math.max(1, Math.ceil(room / slotW)) : data.length > 7 ? 2 : 1
  const cur = data[active]

  function indexAt(x: number) {
    const r = group.current?.getBoundingClientRect()
    if (!r || !r.width) return null
    return Math.min(last, Math.max(0, Math.floor(((x - r.left) / r.width) * data.length)))
  }

  function onPointer(e: React.PointerEvent) {
    const i = indexAt(e.clientX)
    if (i === null) return
    if (e.pointerType === "mouse") {
      setHover(i)
    } else {
      if (e.type === "pointerdown") touched.current = true
      setSelected(i)
      setHover(null)
    }
  }

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const next = e.key === "ArrowRight" ? Math.min(last, i + 1) : e.key === "ArrowLeft" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1
    if (next < 0) return
    e.preventDefault()
    setSelected(next)
    bars.current[next]?.focus()
  }

  return (
    <div className={cn("min-w-0", className)}>
      {/* Two fixed lines, so a long readout never changes the chart's height. */}
      <div className="h-10 min-w-0" aria-live="polite">
        {!hydrated ? (
          <div key="skeleton" aria-hidden className="pt-[3px]">
            <span className="skeleton block h-3 w-40 max-w-full rounded" />
            <span className="skeleton mt-2 block h-2.5 w-24 max-w-full rounded" />
          </div>
        ) : cur ? (
          <>
            <p className="flex min-w-0 items-baseline gap-2 text-[12px]">
              <span className="truncate text-ink-3">{cur.fullLabel}</span>
              <span className="shrink-0 font-medium text-ink tabular">{formatFull(cur.value)}</span>
            </p>
            {cur.meta ? <p className="mt-1 truncate text-[11.5px] text-ink-3">{cur.meta}</p> : null}
          </>
        ) : null}
      </div>

      <div className="relative mt-3 flex" style={{ height }}>
        {/* Y axis */}
        <div aria-hidden className="relative shrink-0" style={{ width: AXIS_W }}>
          <div className="absolute inset-x-0 bottom-0" style={{ height: areaH }}>
            {ticks.map((t) => (
              <span key={t} className="absolute left-0 translate-y-1/2 text-[11px] leading-none text-ink-3 tabular" style={{ bottom: `${(t / top) * 100}%` }}>
                {format(t)}
              </span>
            ))}
          </div>
        </div>

        <div ref={plotRef} className="relative min-w-0 flex-1">
          <div aria-hidden className="absolute inset-x-0 bottom-0" style={{ height: areaH }}>
            {ticks.map((t) => (
              <span key={t} className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-white/[0.09]" : "bg-white/[0.045]")} style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
          </div>

          {!hydrated ? (
            <div key="skeleton" aria-hidden className="skeleton absolute inset-x-0 bottom-0 rounded-xl" style={{ height: areaH }} />
          ) : (
            <div
              key="bars"
              ref={group}
              role="group"
              aria-label={`${label}. Use the left and right arrow keys to move between bars.`}
              className="absolute inset-0 flex touch-pan-y items-end"
              onPointerDown={onPointer}
              onPointerMove={onPointer}
              onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
            >
              {data.map((d, i) => {
                const on = i === active
                const pct = top ? d.value / top : 0
                const barPx = pct * areaH
                const inside = on && barW >= 34 && barPx >= 30
                const delta = d.delta
                const chip = on && (!inside || (delta !== null && delta !== undefined))
                const deltaText = delta === null || delta === undefined ? "" : `, ${delta >= 0 ? "up" : "down"} ${Math.abs(delta * 100).toFixed(1)}% on ${deltaContext}`
                return (
                  <div key={d.key} className="relative flex h-full min-w-0 flex-1 justify-center">
                    <button
                      ref={(el) => {
                        bars.current[i] = el
                      }}
                      type="button"
                      tabIndex={i === selected ? 0 : -1}
                      aria-label={`${d.fullLabel}: ${formatFull(d.value)}${d.meta ? `, ${d.meta}` : ""}${deltaText}`}
                      aria-pressed={on}
                      onClick={() => {
                        if (touched.current) touched.current = false
                        else setSelected(i)
                      }}
                      onFocus={() => setSelected(i)}
                      onKeyDown={(e) => onKeyDown(e, i)}
                      className="group/bar absolute inset-x-0 bottom-0 flex justify-center outline-none"
                      style={{ height: areaH }}
                    >
                      <GrowBar
                        className="absolute bottom-0 origin-bottom rounded-t-[8px] rounded-b-[3px] group-focus-visible/bar:outline-2 group-focus-visible/bar:outline-offset-2 group-focus-visible/bar:outline-violet"
                        style={{ height: d.value > 0 ? `max(${pct * 100}%, 6px)` : 2, width: barW || "64%", maxWidth: 52 }}
                        clock={clock}
                        // The stagger is spread over the series, so 14 daily bars take no longer than 3 monthly ones.
                        delay={data.length > 1 ? (i / (data.length - 1)) * entrance.stagger : 0}
                      >
                        <span
                          className="absolute inset-0 rounded-[inherit] bg-white/[0.035] ring-1 ring-white/[0.06] ring-inset"
                          style={{ backgroundImage: hatch }}
                        />
                        <span className={cn("absolute inset-0 rounded-[inherit] bg-purple transition-opacity duration-150", on ? "opacity-100" : "opacity-0")} />
                        {d.value > 0 ? (
                          <span className={cn("absolute top-[5px] left-1/2 h-[2px] w-[46%] -translate-x-1/2 rounded-full transition-colors duration-150", on ? "bg-white/60" : "bg-white/45")} />
                        ) : (
                          <span className="absolute inset-0 rounded-full bg-white/20" />
                        )}
                        {inside ? (
                          <motion.span className="font-metric absolute inset-x-0 bottom-2 text-center text-[13px] text-ink" style={{ opacity: labelOpacity }}>
                            {format(d.value)}
                          </motion.span>
                        ) : null}
                      </GrowBar>
                    </button>

                    {chip ? (
                      // Hidden while the bars grow, so it never floats above a half-grown bar.
                      <motion.div
                        aria-hidden
                        className={cn("pointer-events-none absolute flex", i < 2 && data.length > 4 ? "left-0 justify-start" : i > last - 2 && data.length > 4 ? "right-0 justify-end" : "left-1/2 w-0 justify-center")}
                        style={{ bottom: `calc(${d.value > 0 ? `max(${pct * areaH}px, 6px)` : "2px"} + 8px)`, opacity: labelOpacity }}
                      >
                        <motion.span layoutId={`bar-chip-${id}`} transition={spring.indicator} className="flex items-center gap-1 whitespace-nowrap">
                          {!inside ? (
                            <span className={cn("inline-flex h-6 items-center rounded-full border border-white/10 bg-elevated text-[11px] font-medium text-ink tabular shadow-[0_6px_16px_-6px_rgba(0,0,0,0.8)]", delta !== null && delta !== undefined ? "gap-1 py-0.5 pr-0.5 pl-2" : "px-2")}>
                              {format(d.value)}
                              <DeltaChip value={delta} size="sm" context={deltaContext} />
                            </span>
                          ) : (
                            <span className="rounded-full bg-surface shadow-[0_6px_16px_-6px_rgba(0,0,0,0.8)]">
                              <DeltaChip value={delta} context={deltaContext} />
                            </span>
                          )}
                        </motion.span>
                      </motion.div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* X axis */}
      {/* X axis. A label wider than its slot is centred under its bar, except at the ends,
          where it lines up with the plot's edge instead of spilling into the card padding. */}
      <div aria-hidden className="mt-2.5 flex h-4" style={{ paddingLeft: AXIS_W }}>
        {data.map((d, i) => {
          const show = i === active || ((last - i) % step === 0 && Math.abs(i - active) >= step)
          const wide = !slotW || labelWidth(d.label) > slotW
          const anchor = wide && i === last && data.length > 1 ? "right-0" : wide && i === 0 && data.length > 1 ? "left-0" : "left-1/2 -translate-x-1/2"
          return (
            <span key={d.key} className="relative min-w-0 flex-1">
              <span className={cn("absolute top-0 text-[11px] leading-4 whitespace-nowrap tabular", anchor, i === active ? "font-medium text-ink" : "text-ink-3", show ? "" : "invisible")}>{d.label}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
