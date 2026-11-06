import { formatMoney, formatNumber } from "@/lib/money"
import { isLiveTime, relDays, sampleNow } from "../finance/format"

/**
 * Formatting for the platform screens (advertising, health, security), in UTC. Relative times
 * count from the same today as every other Control Center page (see demoLag in
 * ../finance/format): the demo's on the server and while hydrating, the real one once the
 * client knows the time. Pass useNow's reading as `now`; without it they count from the demo's.
 */

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })

export const formatDay = (iso: string) => dayFmt.format(new Date(iso))
export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatTime = (iso: string) => `${timeFmt.format(new Date(iso))} UTC`
export const formatDateTime = (iso: string) => `${dayFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))} UTC`

/**
 * "Just now", "3h ago", "Yesterday", "4 days ago". A record made here is measured from the real
 * clock; a sample record from the demo's now, moved on by the days the real today is past it.
 */
export function relTime(iso: string, now?: number | null) {
  const t = new Date(iso).getTime()
  const from = isLiveTime(iso) ? Math.max(now ?? Date.now(), t) : sampleNow(now)
  const mins = Math.round((from - t) / 60_000)
  if (mins < 2) return "Just now"
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  const d = Math.round(mins / 1440)
  return d === 1 ? "Yesterday" : `${d} days ago`
}

/** For day-precision records: "today", "yesterday", "4 days ago". */
export function relDay(iso: string, now?: number | null) {
  const d = relDays(iso, now)
  return d.charAt(0).toLowerCase() + d.slice(1)
}

/**
 * Seeded records carry a day only (stored at noon UTC); entries made in this session carry a
 * real time. Showing "12:00 UTC" for a seeded record would be false precision.
 */
export const isDayPrecision = (iso: string) => iso.endsWith("T12:00:00.000Z")

/**
 * A record's time for lists: "Today", "Yesterday" or "4 days ago" for day-precision records,
 * "Just now" or "25 min ago" for entries made in this session (only ever present on the
 * client, after the store rehydrates). `title` carries the exact value for a tooltip.
 */
export function recordTime(iso: string, now?: number | null) {
  if (isDayPrecision(iso)) return { label: relDays(iso, now), title: formatDate(iso) }
  return { label: relTime(iso, now), title: formatDateTime(iso) }
}

export const usd = (cents: number) => formatMoney(Math.round(cents), "USD")
export const usdCompact = (cents: number) => formatMoney(Math.round(cents), "USD", { compact: true })
export const int = (n: number) => formatNumber(Math.round(n))

export function formatRange(startIso: string, endIso: string) {
  return `${formatDay(startIso)} to ${formatDay(endIso)}`
}

export function initials(name: string) {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("")
}

export const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`
