import type { Drop, DropPhase } from "@/lib/data/types"

const HOUR = 3_600_000

export function dropWindow(drop: Drop, anchor: number) {
  const release = anchor + drop.releaseOffsetHours * HOUR
  return { release, end: release + drop.durationHours * HOUR }
}

/** Phase at a given instant (client, with the demo clock). */
export function dropPhaseAt(drop: Drop, now: number, anchor: number): DropPhase {
  const { release, end } = dropWindow(drop, anchor)
  if (now < release) return "upcoming"
  if (drop.unitsLeft <= 0) return "sold-out"
  if (now < end) return "live"
  return "ended"
}

/** Phase when the demo loads — safe to use on the server for grouping and layout. */
export function initialDropPhase(drop: Drop): DropPhase {
  if (drop.releaseOffsetHours > 0) return "upcoming"
  if (drop.unitsLeft <= 0) return "sold-out"
  if (drop.releaseOffsetHours + drop.durationHours > 0) return "live"
  return "ended"
}

export function splitCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  }
}

export const dropAccessLabel: Record<Drop["access"], string> = {
  "first-come": "First come, first served",
  draw: "Draw — enter before release",
  "early-access": "Early access for followers",
}
