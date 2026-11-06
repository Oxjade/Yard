const HOUR = 3_600_000

/**
 * "less than an hour ago", "1 hour ago", "3 hours ago", "yesterday", "10 days ago": time since a
 * moment `ms` back. Past the first hour, hours are rounded, and a gap that rounds to 24 hours or
 * more is told in whole days, so 23.6 hours reads "yesterday" rather than "24 hours ago" and 36
 * hours is still "yesterday". A moment that hasn't happened yet (negative `ms`) has no "ago": the
 * answer is null and the caller leaves the line out, rather than printing "1 hour ago".
 */
export function agoText(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null
  if (ms < HOUR) return "less than an hour ago"
  const hours = Math.round(ms / HOUR)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? "yesterday" : `${days} days ago`
}
