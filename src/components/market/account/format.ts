import { DEMO_TODAY } from "@/lib/data/seed"

/**
 * Dates on the shopper's own pages. Sample data is dated relative to the demo's
 * reference day (as Studio does), so "3 days ago" stays true whenever the prototype
 * is opened. Formatting pins the UTC zone so every render agrees.
 */
export const DEMO_NOW = new Date(`${DEMO_TODAY}T12:00:00Z`).getTime()
const DAY = 86_400_000

export function daysSince(iso: string) {
  return Math.floor((DEMO_NOW - new Date(iso).getTime()) / DAY)
}

export function formatDay(iso: string, opts: { year?: boolean; weekday?: boolean } = {}) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: opts.year ? "numeric" : undefined,
    weekday: opts.weekday ? "short" : undefined,
    timeZone: "UTC",
  })
}

export function relativeDay(iso: string) {
  const d = daysSince(iso)
  if (d <= 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 7) return `${d} days ago`
  return formatDay(iso)
}

/** Buckets for grouping a feed or a history list. */
export function dayBucket(iso: string) {
  const d = daysSince(iso)
  if (d <= 0) return "Today"
  if (d < 7) return "This week"
  if (d < 14) return "Last week"
  if (d < 31) return "Earlier this month"
  return "Earlier"
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

/** Only same-site paths are followed after sign-in. */
export function safeNext(next: string | null | undefined, fallback = "/you") {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback
  return next
}
