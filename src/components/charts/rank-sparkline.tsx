import { cn } from "@/lib/utils"

/**
 * The rank history as a line (§6.3): the last 8 daily-closed editions plus this one. Rank 1 sits at
 * the top, so a climb reads as a line going up. A day off the chart breaks the line. Decorative:
 * the row's accessible text already says the previous rank and peak.
 */
export function RankSparkline({ history, size, className }: { history: (number | null)[]; size: number; className?: string }) {
  const w = 72
  const h = 24
  const pad = 3
  const n = history.length
  const ranks = history.filter((x): x is number => x !== null)
  if (n < 2 || ranks.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-6 w-[72px]", className)} aria-hidden />
  const max = Math.max(size, ...ranks)
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2)
  const y = (r: number) => pad + ((r - 1) / Math.max(1, max - 1)) * (h - pad * 2)
  const segments: string[] = []
  let current = ""
  history.forEach((r, i) => {
    if (r === null) {
      if (current) segments.push(current)
      current = ""
      return
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(r).toFixed(1)}`
  })
  if (current) segments.push(current)
  const last = history[n - 1]
  const first = ranks[0]
  const climbing = last !== null && last < first
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-6 w-[72px] overflow-visible", className)} aria-hidden>
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={climbing ? "#9452ff" : "#858585"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
      {last !== null ? <circle cx={x(n - 1)} cy={y(last)} r="2.5" fill={climbing ? "#9452ff" : "#f5f5f5"} /> : null}
    </svg>
  )
}
