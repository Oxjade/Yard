import { brandById } from "@/lib/data/brands"
import type { Drop, DropPhase } from "@/lib/data/types"
import { countryTimeZone, dateIn, shiftDate, zonedTimeToUtc } from "@/lib/data/zones"

const HOUR = 3_600_000

/**
 * A sample drop's release at the local time it was given (see Drop.releaseLocal): "18:00 in
 * Lagos, two days after the day the demo loads", or the first whole hour after `hoursOut`. Null
 * when the drop has none, or its release was set afresh since.
 */
function localRelease(drop: Drop, anchor: number) {
  const spec = drop.releaseLocal
  if (!spec || spec.fromOffset !== drop.releaseOffsetHours) return null
  // Every market's zone is a whole number of hours from UTC, so a whole UTC hour is a whole local one.
  if ("hoursOut" in spec) return Math.ceil((anchor + spec.hoursOut * HOUR) / HOUR) * HOUR
  const brand = brandById.get(drop.brandId)
  const zone = brand ? countryTimeZone[brand.country] : "UTC"
  return zonedTimeToUtc(shiftDate(dateIn(zone, anchor), spec.daysOut), spec.time, zone)
}

export function dropWindow(drop: Drop, anchor: number) {
  const release = localRelease(drop, anchor) ?? anchor + drop.releaseOffsetHours * HOUR
  return { release, end: release + drop.durationHours * HOUR }
}

/**
 * The same drop with `releaseOffsetHours` set to where its local release falls for this anchor,
 * for code that reads the offset directly (the Studio drop builder). Unchanged when it has none.
 */
export function pinDropRelease(drop: Drop, anchor: number): Drop {
  const at = localRelease(drop, anchor)
  if (at === null || !drop.releaseLocal) return drop
  const offset = (at - anchor) / HOUR
  return { ...drop, releaseOffsetHours: offset, releaseLocal: { ...drop.releaseLocal, fromOffset: offset } }
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
  draw: "Entry by draw before release",
  "early-access": "Early access for followers",
}
