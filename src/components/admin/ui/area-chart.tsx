"use client"

import { useId } from "react"
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useHydrated } from "@/hooks/use-hydrated"
import { PanelSkeleton } from "./panel"

type Row = { date: string } & Record<string, number | string>

function GlassTooltip({ active, payload, label, format, labels }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string; format: (n: number) => string; labels: Record<string, string> }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-strong min-w-40 rounded-xl px-3 py-2.5 text-[12px]">
      <p className="font-label text-[11px] text-ink-2">{label ? new Date(label).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : null}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="mt-1.5 flex items-center justify-between gap-4 text-ink">
          <span className="flex items-center gap-2 text-ink-2">
            <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
            {labels[p.dataKey] ?? p.dataKey}
          </span>
          <span className="tabular">{format(p.value)}</span>
        </p>
      ))}
    </div>
  )
}

/**
 * The Control Center's main chart: the primary series as a purple area with a soft
 * downward falloff, the secondary as a dashed grey line. Fixed height; a same-size
 * skeleton stands in until the chart can measure itself, so nothing shifts.
 */
export function AdminAreaChart({ data, primary, secondary, format, height = 280 }: { data: Row[]; primary: { key: string; label: string }; secondary?: { key: string; label: string }; format: (n: number) => string; height?: number }) {
  const id = useId()
  const hydrated = useHydrated()
  const tick = { fill: "#858585", fontSize: 11 }
  const labels = { [primary.key]: primary.label, ...(secondary ? { [secondary.key]: secondary.label } : {}) }
  return (
    <div style={{ height }} className="w-full">
      {!hydrated ? (
        <PanelSkeleton className="h-full w-full" />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 6, bottom: 0, left: -14 }}>
            <defs>
              <linearGradient id={`a-${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6d19d9" stopOpacity={0.42} />
                <stop offset="55%" stopColor="#6d19d9" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#6d19d9" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tickFormatter={(v) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} tick={tick} axisLine={false} tickLine={false} minTickGap={32} />
            <YAxis tickFormatter={(v) => format(v)} tick={tick} axisLine={false} tickLine={false} width={64} />
            <Tooltip cursor={{ stroke: "rgba(255,255,255,0.16)", strokeDasharray: "3 3" }} content={<GlassTooltip format={format} labels={labels} />} />
            <Area type="monotone" dataKey={primary.key} stroke="#9452ff" strokeWidth={2} fill={`url(#a-${id})`} activeDot={{ r: 4.5, fill: "#f5f5f5", stroke: "#6d19d9", strokeWidth: 2 }} animationDuration={900} />
            {secondary ? <Line type="monotone" dataKey={secondary.key} stroke="#858585" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{ r: 3.5, fill: "#858585", strokeWidth: 0 }} animationDuration={900} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

