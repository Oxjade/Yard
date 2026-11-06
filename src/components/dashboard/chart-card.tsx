"use client"

import { useRef } from "react"
import { useReducedMotion } from "motion/react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useSeen } from "@/components/dashboard/insight/use-entrance"
import { useHydrated } from "@/hooks/use-hydrated"
import { chartEasing } from "@/lib/motion"
import { cn } from "@/lib/utils"

type Datum = Record<string, string | number>

function ChartTooltip({ active, payload, label, format, labels }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string; format: (n: number) => string; labels: Record<string, string> }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-strong rounded-lg px-3 py-2 text-xs">
      <p className="text-ink-2">{label ? new Date(label).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="mt-1 flex items-center gap-2 text-ink tabular">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {labels[p.dataKey] ?? p.dataKey}: {format(p.value)}
        </p>
      ))}
    </div>
  )
}

/**
 * Time-series chart. Purple is the primary series; a second series, when shown, is a
 * muted line so the primary always reads first. The chart is drawn the first time it is
 * seen (an empty frame of the same height holds its place until then), so areas draw in from
 * the left and bars grow from the baseline in 600ms as it appears, not off screen on mount
 * (Recharts skips it under reduced motion); later data changes ease from the previous values.
 */
export function TimeSeriesChart({
  data,
  series,
  format,
  height = 260,
  kind = "area",
  className,
}: {
  data: Datum[]
  series: { key: string; label: string; color?: string }[]
  format: (n: number) => string
  height?: number
  kind?: "area" | "bar"
  className?: string
}) {
  const labels = Object.fromEntries(series.map((s) => [s.key, s.label]))
  const colors = ["#6d19d9", "#858585", "#f5ff00"]
  const tick = { fill: "#858585", fontSize: 11 }
  const xFormat = (v: string) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
  const frame = useRef<HTMLDivElement>(null)
  const hydrated = useHydrated()
  const reduce = useReducedMotion()
  const seen = useSeen(frame)

  return (
    <div ref={frame} className={cn("w-full", className)} style={{ height }}>
      {hydrated && (reduce || seen) ? (
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} stroke="#1a1a1a" />
              <XAxis dataKey="date" tickFormatter={xFormat} tick={tick} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis tickFormatter={(v) => format(v)} tick={tick} axisLine={false} tickLine={false} width={64} />
              <Tooltip cursor={{ fill: "rgba(109,25,217,0.14)" }} content={<ChartTooltip format={format} labels={labels} />} />
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} fill={s.color ?? colors[i]} radius={[3, 3, 0, 0]} maxBarSize={18} animationDuration={600} animationEasing={chartEasing} />
              ))}
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color ?? colors[i]} stopOpacity={i === 0 ? 0.16 : 0} />
                    <stop offset="100%" stopColor={s.color ?? colors[i]} stopOpacity={i === 0 ? 0.16 : 0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="#1a1a1a" />
              <XAxis dataKey="date" tickFormatter={xFormat} tick={tick} axisLine={false} tickLine={false} minTickGap={28} />
              <YAxis tickFormatter={(v) => format(v)} tick={tick} axisLine={false} tickLine={false} width={64} />
              <Tooltip cursor={{ stroke: "#3a3a3a" }} content={<ChartTooltip format={format} labels={labels} />} />
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color ?? colors[i]}
                  strokeWidth={i === 0 ? 2 : 1.5}
                  strokeDasharray={i === 0 ? undefined : "4 4"}
                  fill={`url(#fill-${s.key})`}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  animationDuration={600}
                  animationEasing={chartEasing}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      ) : null}
    </div>
  )
}
