import { countries, type CountryCode } from "@/config/markets"
import { categoryBySlug } from "@/lib/data"
import type { CategorySlug } from "@/lib/data/types"

/**
 * Formatting for the marketplace management screens. Dates are relative to the demo's
 * reference day and formatted in UTC so the server HTML and the client always agree.
 */

const DEMO_NOW = new Date("2026-11-05T12:00:00Z").getTime()

export function relDays(iso: string) {
  const d = Math.floor((DEMO_NOW - new Date(iso).getTime()) / 86_400_000)
  if (d <= 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 31) return `${d} days ago`
  const m = Math.round(d / 30)
  return m <= 1 ? "A month ago" : `${m} months ago`
}

export function daysSince(iso: string) {
  return Math.max(0, Math.floor((DEMO_NOW - new Date(iso).getTime()) / 86_400_000))
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })

export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatDateTime = (iso: string) => `${dateTimeFmt.format(new Date(iso))} UTC`

export function countryName(code: string) {
  return countries[code as CountryCode]?.name ?? code
}

export function categoryName(slug: string) {
  return categoryBySlug.get(slug as CategorySlug)?.name ?? slug.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())
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

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}
