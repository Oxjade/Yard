import { countries, type CountryCode, type CurrencyCode } from "@/config/markets"
import { campaignTypes, campaigns as allCampaigns, type Campaign, type CampaignType, type Placement } from "@/lib/data/ads"
import { productById } from "@/lib/data/products"
import { randInt } from "@/lib/data/seed"
import { dropPhaseAt, initialDropPhase } from "@/lib/drops"
import { convert, formatMoney } from "@/lib/money"
import type { Brand, Drop, DropPhase } from "@/lib/data/types"
import type { DropMeta, Promotion } from "./store"

export const HOUR = 3_600_000
export const DAY = 86_400_000

/** Ids for records created in this browser; the local-id patterns in the route files match these. */
export function localId(prefix: "d_local_" | "cmp_local_" | "promo_") {
  return `${prefix}${Date.now().toString(36)}`
}

/* ---------- Time zones ---------- */

/** Each market's main time zone, with a stable abbreviation for zones Intl only names as "GMT+n". */
export const countryZone: Record<CountryCode, { tz: string; city: string; abbr?: string }> = {
  NG: { tz: "Africa/Lagos", city: "Lagos", abbr: "WAT" },
  GH: { tz: "Africa/Accra", city: "Accra", abbr: "GMT" },
  KE: { tz: "Africa/Nairobi", city: "Nairobi", abbr: "EAT" },
  ZA: { tz: "Africa/Johannesburg", city: "Johannesburg", abbr: "SAST" },
  GB: { tz: "Europe/London", city: "London" },
  FR: { tz: "Europe/Paris", city: "Paris" },
  DE: { tz: "Europe/Berlin", city: "Berlin" },
  US: { tz: "America/New_York", city: "New York" },
  MX: { tz: "America/Mexico_City", city: "Mexico City", abbr: "CST" },
  JP: { tz: "Asia/Tokyo", city: "Tokyo", abbr: "JST" },
  KR: { tz: "Asia/Seoul", city: "Seoul", abbr: "KST" },
}

export function brandZone(brand: Pick<Brand, "country">) {
  return countryZone[brand.country]
}

const partsCache = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(tz: string) {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    partsCache.set(tz, f)
  }
  return f
}

function zonedParts(utcMs: number, tz: string) {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]))
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) }
}

/** Offset of a zone from UTC at an instant, in ms. */
export function zoneOffset(utcMs: number, tz: string) {
  const z = zonedParts(utcMs, tz)
  return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - Math.floor(utcMs / 1000) * 1000
}

/** A wall-clock date ("2026-11-12") and time ("11:00") in a zone → UTC ms. Null when unparseable. */
export function zonedToUtc(date: string, time: string, tz: string) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})$/.exec(time)
  if (!dm || !tm) return null
  const guess = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]))
  let utc = guess - zoneOffset(guess, tz)
  const second = zoneOffset(utc, tz)
  if (guess - second !== utc) utc = guess - second
  return utc
}

const pad = (n: number) => String(n).padStart(2, "0")

/** UTC ms → the wall-clock date and time in a zone, as form values. */
export function utcToZoned(utcMs: number, tz: string) {
  const z = zonedParts(utcMs, tz)
  return { date: `${z.y}-${pad(z.mo)}-${pad(z.d)}`, time: `${pad(z.h)}:${pad(z.mi)}` }
}

/** Today's calendar date in a zone (yyyy-mm-dd). */
export function todayIn(tz: string, now: number) {
  return utcToZoned(now, tz).date
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string) {
  return Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / DAY)
}

export function zoneAbbr(tz: string, at: number) {
  const known = Object.values(countryZone).find((z) => z.tz === tz)?.abbr
  if (known) return known
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value
  return name ?? tz
}

export function zoneLongName(tz: string, at: number) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? tz
}

/** "Thu 12 Nov, 11:00" in a zone. */
export function formatInZone(utcMs: number, tz: string, opts: { weekday?: boolean; year?: boolean } = {}) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: opts.weekday === false ? undefined : "short",
    day: "numeric",
    month: "short",
    year: opts.year ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(utcMs))
}

export function formatTimeInZone(utcMs: number, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(utcMs))
}

/** "12 Nov 2026" for a yyyy-mm-dd calendar date. */
export function formatDate(date: string, opts: { year?: boolean; weekday?: boolean } = {}) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: opts.weekday ? "short" : undefined, day: "numeric", month: "short", year: opts.year === false ? undefined : "numeric" }).format(new Date(`${date}T12:00:00Z`))
}

/** "in 2 days", "in 5 hours", "3 days ago". */
export function relativeTime(targetMs: number, now: number) {
  const diff = targetMs - now
  const abs = Math.abs(diff)
  const unit = abs >= DAY ? { n: Math.round(abs / DAY), u: "day" } : abs >= HOUR ? { n: Math.round(abs / HOUR), u: "hour" } : { n: Math.max(1, Math.round(abs / 60_000)), u: "minute" }
  const text = `${unit.n} ${unit.u}${unit.n === 1 ? "" : "s"}`
  return diff >= 0 ? `in ${text}` : `${text} ago`
}

/* ---------- Drops ---------- */

/** StatusBadge tones (src/components/dashboard/status-badge.tsx). */
export type Tone = "neutral" | "info" | "attention" | "success" | "danger" | "muted"

export type StudioDropStatus = "draft" | "scheduled" | "live" | "sold-out" | "ended"

export const dropStatusMeta: Record<StudioDropStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "muted" },
  scheduled: { label: "Scheduled", tone: "info" },
  live: { label: "Live", tone: "info" },
  "sold-out": { label: "Sold out", tone: "success" },
  ended: { label: "Ended", tone: "muted" },
}

export function studioDropStatus(drop: Drop, meta: DropMeta | undefined, now: number | null, anchor: number | null): StudioDropStatus {
  if (meta?.draft) return "draft"
  const phase: DropPhase = now === null || anchor === null ? initialDropPhase(drop) : dropPhaseAt(drop, now, anchor)
  return phase === "upcoming" ? "scheduled" : phase
}

/** Drops created in this browser. The marketplace reads the sample catalogue, so no shopper has seen them. */
export const isLocalDrop = (drop: Pick<Drop, "id">) => /^d_local_/.test(drop.id)

/**
 * Notify-me sign-ups. Sample numbers for the seeded drops, stable per drop. A drop made in this
 * browser has none: it isn't in the marketplace until the catalogue backend is connected.
 */
export function notifyCount(drop: Drop, status: StudioDropStatus, followers: number) {
  if (status === "draft" || isLocalDrop(drop)) return 0
  const base = Math.round(followers * (0.004 + randInt(`notify-${drop.id}`, 0, 100) / 10_000))
  return Math.max(12, base + randInt(`notify-extra-${drop.id}`, 0, 140))
}

export function dropUnitsSold(drop: Drop) {
  return Math.max(0, drop.totalUnits - drop.unitsLeft)
}

/** Sample revenue: units sold at the average price of the drop's products, in the brand currency. */
export function dropRevenue(drop: Drop, currency: CurrencyCode) {
  const prices = drop.productIds.map((id) => productById.get(id)).filter(Boolean).map((p) => convert(p!.price, p!.currency, currency))
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
  return Math.round(avg * dropUnitsSold(drop))
}

/* ---------- Promotions ---------- */

export type PromotionStatus = "active" | "scheduled" | "paused" | "expired" | "used-up"

export const promotionStatusMeta: Record<PromotionStatus, { label: string; tone: Tone }> = {
  active: { label: "Active", tone: "info" },
  scheduled: { label: "Scheduled", tone: "info" },
  paused: { label: "Paused", tone: "muted" },
  expired: { label: "Ended", tone: "muted" },
  "used-up": { label: "Limit reached", tone: "muted" },
}

export function promotionStatus(p: Promotion, today: string): PromotionStatus {
  if (p.endsOn && p.endsOn < today) return "expired"
  if (p.usageLimit !== null && p.used >= p.usageLimit) return "used-up"
  if (p.paused) return "paused"
  if (p.startsOn > today) return "scheduled"
  return "active"
}

export function discountLabel(p: Pick<Promotion, "discountType" | "value">, currency: CurrencyCode) {
  return p.discountType === "percentage" ? `${p.value}% off` : `${formatMoney(p.value, currency)} off`
}

/* ---------- Advertising ---------- */

export const placementMeta: Record<Placement, { label: string; where: string }> = {
  "home-featured-brands": { label: "Discover, featured brands", where: "One of the labelled sponsored slots beside the editors' picks on Discover." },
  "explore-brands": { label: "Brands directory", where: "The featured strip at the top of the brands directory." },
  "category-grid": { label: "Category grid", where: "Fixed sponsored positions in the category grid, never in the first four." },
  "search-results": { label: "Search results", where: "One sponsored slot in results within the category. Never above a search for another brand's name." },
  "drops-feature": { label: "Drops, featured release", where: "The featured release on Drops and the Discover countdown strip." },
  "home-spotlight": { label: "Discover hero, spotlight", where: "The secondary campaign tile beside the Discover hero." },
  "editorial-collection": { label: "Curated collection", where: "Your name as sponsor on a curated collection. The edit itself stays independent." },
}

export type TargetKind = "brand" | "products" | "drop" | "collection" | "curated"

/** What each campaign type can promote. The first kind is the default. */
export const typeTargets: Record<CampaignType, TargetKind[]> = {
  "sponsored-brand": ["brand"],
  "sponsored-product": ["products"],
  "sponsored-drop": ["drop"],
  "homepage-spotlight": ["brand", "drop", "collection"],
  "category-promotion": ["brand", "collection"],
  "editorial-sponsorship": ["curated"],
}

export const targetKindLabel: Record<TargetKind, string> = {
  brand: "Your brand",
  products: "A product",
  drop: "A drop",
  collection: "A collection",
  curated: "A curated collection",
}

/** Types whose placements sit inside a category need at least one category. */
export function needsCategory(type: CampaignType) {
  return type === "sponsored-product" || type === "category-promotion"
}

export function campaignCost(type: CampaignType, days: number, priceUsd: number) {
  return campaignTypes[type].unit === "day" ? priceUsd * days : priceUsd
}

/** VAT added at checkout for ad purchases, by the brand's country. */
export const adVatRate: Partial<Record<CountryCode, number>> = { NG: 0.075, GB: 0.2, FR: 0.2, DE: 0.19, ZA: 0.15, KE: 0.16, GH: 0.15 }

export function usdAndLocal(usdCents: number, currency: CurrencyCode) {
  const usd = formatMoney(usdCents, "USD")
  if (currency === "USD") return { usd, local: null as string | null }
  return { usd, local: formatMoney(convert(usdCents, "USD", currency), currency) }
}

/** One price written the same way everywhere in Advertising: "$210.00 (₦325,500.00)". */
export function usdAndLocalText(usdCents: number, currency: CurrencyCode) {
  const { usd, local } = usdAndLocal(usdCents, currency)
  return local ? `${usd} (${local})` : usd
}

/** A campaign's booking price in USD, whatever currency it was stored in. */
export function campaignPriceUsd(c: Pick<Campaign, "budget" | "currency">) {
  return c.currency === "USD" ? c.budget : convert(c.budget, c.currency, "USD")
}

/** Impressions per day from campaigns that have run, as a range. An estimate, not a promise. */
export function impressionEstimate(type: CampaignType, days: number) {
  const ran = allCampaigns.filter((c) => c.type === type && c.results.impressions > 0)
  const perDay = ran.length ? ran.reduce((s, c) => s + c.results.impressions / Math.max(1, Math.min(c.days, Math.abs(c.startDaysFromToday) || c.days)), 0) / ran.length : 1500
  const total = perDay * days
  const round = (n: number) => Math.max(100, Math.round(n / 100) * 100)
  return { low: round(total * 0.7), high: round(total * 1.3) }
}

export type CampaignMetrics = {
  spend: number
  impressions: number
  reach: number
  clicks: number
  ctr: number
  productViews: number
  addToCarts: number
  purchases: number
  revenue: number
  roas: number | null
}

/** Spend counts only what has run or is running; drafts, reviews and rejections cost nothing. */
export function campaignSpends(c: Campaign) {
  return c.status === "active" || c.status === "completed" || c.status === "paused"
}

export function campaignMetrics(list: Campaign[]): CampaignMetrics {
  const sum = (f: (c: Campaign) => number) => list.reduce((s, c) => s + f(c), 0)
  const spend = sum((c) => (campaignSpends(c) ? convert(c.budget, c.currency, "USD") : 0))
  const impressions = sum((c) => c.results.impressions)
  const clicks = sum((c) => c.results.clicks)
  const revenue = sum((c) => convert(c.results.revenue, c.currency, "USD"))
  return {
    spend,
    impressions,
    reach: sum((c) => c.results.reach),
    clicks,
    ctr: impressions ? clicks / impressions : 0,
    productViews: sum((c) => c.results.productViews),
    addToCarts: sum((c) => c.results.addToCarts),
    purchases: sum((c) => c.results.purchases),
    revenue,
    roas: spend ? revenue / spend : null,
  }
}

export function countryName(code: string) {
  return countries[code as CountryCode]?.name ?? code
}
