import { daysAgo } from "@/lib/data/seed"
import { formatMoney, formatNumber } from "@/lib/money"

/**
 * Formatting for the platform screens (advertising, health, security). Times are relative
 * to the demo's reference moment and formatted in UTC, so the server HTML and the first
 * client render always agree.
 */

export const DEMO_NOW = new Date("2026-11-05T12:00:00Z").getTime()

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })

export const formatDay = (iso: string) => dayFmt.format(new Date(iso))
export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatTime = (iso: string) => `${timeFmt.format(new Date(iso))} UTC`
export const formatDateTime = (iso: string) => `${dayFmt.format(new Date(iso))}, ${timeFmt.format(new Date(iso))} UTC`

/** "Just now", "3h ago", "Yesterday", "4 days ago", measured from the demo's reference moment unless `now` is given. */
export function relTime(iso: string, now = DEMO_NOW) {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (mins < 2) return "Just now"
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`
  const d = Math.round(mins / 1440)
  return d === 1 ? "Yesterday" : `${d} days ago`
}

/** For day-precision records: "today", "yesterday", "4 days ago". */
export function relDay(iso: string) {
  const d = Math.floor((DEMO_NOW - new Date(iso).getTime()) / 86_400_000)
  if (d <= 0) return "today"
  return d === 1 ? "yesterday" : `${d} days ago`
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
export function recordTime(iso: string) {
  if (isDayPrecision(iso)) {
    const d = relDay(iso)
    return { label: d.charAt(0).toUpperCase() + d.slice(1), title: formatDate(iso) }
  }
  return { label: relTime(iso, Math.max(Date.now(), new Date(iso).getTime())), title: formatDateTime(iso) }
}

export const usd = (cents: number) => formatMoney(Math.round(cents), "USD")
export const usdCompact = (cents: number) => formatMoney(Math.round(cents), "USD", { compact: true })
export const int = (n: number) => formatNumber(Math.round(n))

/**
 * A campaign's start and end as ISO dates, from its offset to the demo's reference day. Only for
 * comparing bookings with each other (slot clashes); the dates a person reads come from
 * campaignDates in @/lib/data/ads, the brand's calendar days that Studio and notifications use.
 */
export function campaignWindow(startDaysFromToday: number, days: number) {
  return { start: daysAgo(-startDaysFromToday), end: daysAgo(-(startDaysFromToday + days - 1)) }
}

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
