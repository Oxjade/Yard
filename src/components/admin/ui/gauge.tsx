"use client"

import { motion } from "motion/react"

/**
 * A ring gauge for a ratio (0–1) with a threshold tick. Purple arc on a hairline track;
 * the value turns yellow when it falls under the threshold.
 */
export function RingGauge({ value, threshold, size = 132, label, sublabel }: { value: number; threshold?: number; size?: number; label: string; sublabel?: string }) {
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const below = threshold !== undefined && value < threshold
  const tickAngle = threshold !== undefined ? threshold * 360 - 90 : 0
  const tx = size / 2 + r * Math.cos((tickAngle * Math.PI) / 180)
  const ty = size / 2 + r * Math.sin((tickAngle * Math.PI) / 180)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}: ${(value * 100).toFixed(1)}%`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={below ? "#f5ff00" : "#6d19d9"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value) }}
          transition={{ type: "spring", stiffness: 60, damping: 18, mass: 1 }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {threshold !== undefined ? <circle cx={tx} cy={ty} r={3} fill="#f5f5f5" stroke="#080808" strokeWidth={2} /> : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-metric text-[1.75rem] text-ink">{(value * 100).toFixed(1)}%</span>
        {sublabel ? <span className="mt-1 text-[11px] text-ink-3">{sublabel}</span> : null}
      </div>
    </div>
  )
}

/** A thin proportional bar split into labelled segments. */
export function SplitBar({ segments }: { segments: { label: string; value: number; tone: "purple" | "acid" | "grey" | "ink" }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const tone = { purple: "bg-purple", acid: "bg-acid", grey: "bg-ink-3", ink: "bg-ink" }
  return (
    <div>
      <div className="flex h-2 w-full gap-[3px] overflow-hidden rounded-full">
        {segments.map((s, i) => (
          <motion.span
            key={s.label}
            className={`${tone[s.tone]} h-full rounded-full`}
            initial={{ width: 0 }}
            animate={{ width: `${(s.value / total) * 100}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 22, delay: 0.15 + i * 0.06 }}
          />
        ))}
      </div>
      <ul className="mt-3 grid gap-1.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="flex items-center gap-2 text-ink-2">
              <span className={`${tone[s.tone]} size-2 rounded-full`} aria-hidden />
              {s.label}
            </span>
            <span className="tabular text-ink">{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
