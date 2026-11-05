"use client"

import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { dropPhaseAt, dropWindow, initialDropPhase } from "@/lib/drops"
import type { Drop, DropPhase } from "@/lib/data/types"

export type DropClock = {
  phase: DropPhase
  /** Null until mounted: the clock is never read during prerender. */
  now: number | null
  release: number | null
  end: number | null
}

/**
 * A drop's phase on the demo clock. Before mount it falls back to the phase the demo loads
 * with, so the server HTML and the first client render agree; after mount it follows the
 * clock, so a drop that opens while the page is up moves from upcoming to live by itself.
 */
export function useDropClock(drop: Drop, intervalMs = 1000): DropClock {
  const now = useNow(intervalMs)
  if (now === null) return { phase: initialDropPhase(drop), now: null, release: null, end: null }
  const anchor = getDemoAnchor()
  const { release, end } = dropWindow(drop, anchor)
  return { phase: dropPhaseAt(drop, now, anchor), now, release, end }
}

/** Phase for every drop in a list, on one shared tick. */
export function useDropPhases(drops: Drop[], intervalMs = 15_000) {
  const now = useNow(intervalMs)
  const anchor = now === null ? null : getDemoAnchor()
  const phases = new Map<string, DropPhase>()
  for (const d of drops) phases.set(d.id, now === null || anchor === null ? initialDropPhase(d) : dropPhaseAt(d, now, anchor))
  return { phases, now, anchor }
}

/** "2 days 4 hours", "3 hours 12 minutes", "8 minutes": the plain-language gap before a release. */
export function releasesIn(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  if (days > 0) return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day")
  if (hours > 0) return minutes > 0 ? `${unit(hours, "hour")} ${unit(minutes, "minute")}` : unit(hours, "hour")
  if (minutes > 0) return unit(minutes, "minute")
  return "under a minute"
}

/** "3h 12m", "2d 4h", "8m": the compact form for tight columns. */
export function releasesInShort(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return `${hours}h ${minutes}m`
  return minutes > 0 ? `${minutes}m` : "<1m"
}
