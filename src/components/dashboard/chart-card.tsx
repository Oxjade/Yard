"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
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
 * muted line so the primary always reads first.
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
  const colors = ["#7b2cff", "#716b79", "#e7ff36"]
  const tick = { fill: "#716b79", fontSize: 11 }
  const xFormat = (v: string) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="#1e1a26" />
            <XAxis dataKey="date" tickFormatter={xFormat} tick={tick} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={(v) => format(v)} tick={tick} axisLine={false} tickLine={false} width={64} />
            <Tooltip cursor={{ fill: "rgba(123,44,255,0.08)" }} content={<ChartTooltip format={format} labels={labels} />} />
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} fill={s.color ?? colors[i]} radius={[3, 3, 0, 0]} maxBarSize={18} />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color ?? colors[i]} stopOpacity={i === 0 ? 0.32 : 0} />
                  <stop offset="100%" stopColor={s.color ?? colors[i]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="#1e1a26" />
            <XAxis dataKey="date" tickFormatter={xFormat} tick={tick} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tickFormatter={(v) => format(v)} tick={tick} axisLine={false} tickLine={false} width={64} />
            <Tooltip cursor={{ stroke: "#3a3247" }} content={<ChartTooltip format={format} labels={labels} />} />
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
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
