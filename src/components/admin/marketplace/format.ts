import { countries, type CountryCode } from "@/config/markets"
import { categoryBySlug } from "@/lib/data"
import type { CategorySlug } from "@/lib/data/types"
import { daysUntil, relDays as relDaysFrom } from "../finance/format"

/**
 * Formatting for the marketplace management screens, in UTC. Relative days count from the same
 * today as every other Control Center page (see demoLag in ../finance/format): the demo's on the
 * server and while hydrating, the real one once the client knows the time. Pass useNow's reading
 * as `now`; without it they count from the demo's today.
 */

export function relDays(iso: string, now?: number | null) {
  return relDaysFrom(iso, now)
}

export function daysSince(iso: string, now?: number | null) {
  return Math.max(0, -daysUntil(iso, now))
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
