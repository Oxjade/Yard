import { countries, countryCodes, type CountryCode, type CurrencyCode } from "@/config/markets"
import type { ShippingProfileBody, StudioShippingDto } from "@/lib/api/contracts/shipping"
import { isDate, makeCalendar, daysBetween, WEEKDAYS } from "@/lib/shipping/calendar"
import { estimateDelivery } from "@/lib/shipping/estimate"
import { parseAmount, toInput } from "@/components/studio/business/settings-model"

/**
 * The Shipping & fulfilment form (§6.5): what Studio edits, how it maps to and from
 * PUT /api/studio/shipping, the same validation the server runs (so errors show inline before a
 * round trip), and the live estimate preview computed with the server's engine.
 */

export type Service = "standard" | "express" | "pickup"
export type MethodForm = { service: Service; label: string; enabled: boolean; transitMin: string; transitMax: string; price: string; freeOver: string; carrierLabel: string | null; extraRates: { minSubtotalMinor: number; amountMinor: number }[] }
export type ZoneForm = { key: string; name: string; kind: "domestic" | "regional" | "international" | "custom"; countries: string[]; enabled: boolean; methods: MethodForm[] }
export type ClosureForm = { key: string; dateFrom: string; dateTo: string; reason: string }
export type ShippingForm = {
  originCountry: CountryCode
  originCity: string
  handlingMin: string
  handlingMax: string
  cutoffLocal: string
  workdays: number
  localPickup: boolean
  pickupLocationId: string | null
  zones: ZoneForm[]
  closures: ClosureForm[]
}

let seq = 0
export const newKey = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
export const serviceName: Record<Service, string> = { standard: "Standard", express: "Express", pickup: "Pickup" }

export function fromDto(d: StudioShippingDto): ShippingForm {
  const cur = d.profile.currency as CurrencyCode
  return {
    originCountry: d.profile.originCountry as CountryCode,
    originCity: d.profile.originCity,
    handlingMin: String(d.profile.handlingMin),
    handlingMax: String(d.profile.handlingMax),
    cutoffLocal: d.profile.cutoffLocal,
    workdays: d.profile.workdays,
    localPickup: d.profile.localPickup,
    pickupLocationId: d.profile.pickupLocationId,
    zones: d.zones.map((z) => ({
      key: newKey("z"),
      name: z.name,
      kind: z.kind,
      countries: z.countries,
      enabled: z.enabled,
      methods: z.methods.map((m) => {
        const base = m.rates.find((r) => r.minSubtotalMinor === 0)
        const free = m.rates.filter((r) => r.amountMinor === 0 && r.minSubtotalMinor > 0).sort((a, b) => a.minSubtotalMinor - b.minSubtotalMinor)[0]
        return {
          service: m.service,
          label: m.label,
          enabled: m.enabled,
          transitMin: String(m.transitMin),
          transitMax: String(m.transitMax),
          price: toInput(base?.amountMinor ?? 0, cur),
          freeOver: free ? toInput(free.minSubtotalMinor, cur) : "",
          carrierLabel: m.carrierLabel,
          // Tiers this form doesn't show are kept as they are.
          extraRates: m.rates.filter((r) => r !== base && r !== free).map((r) => ({ minSubtotalMinor: r.minSubtotalMinor, amountMinor: r.amountMinor })),
        }
      }),
    })),
    closures: d.closures.map((c) => ({ key: newKey("c"), dateFrom: c.dateFrom, dateTo: c.dateTo, reason: c.reason ?? "" })),
  }
}

const whole = (s: string) => /^\d+$/.test(s.trim())

/** Field errors keyed by the body's paths (the server uses the same), plus the inputs' ids. */
export function validate(f: ShippingForm, cur: CurrencyCode): Record<string, string> {
  const e: Record<string, string> = {}
  if (!f.originCity.trim()) e.originCity = "Enter the city you ship from."
  const hMin = Number(f.handlingMin)
  const hMax = Number(f.handlingMax)
  if (!whole(f.handlingMin) || hMin > 30) e.handlingMin = "Use 0 to 30 business days."
  if (!whole(f.handlingMax) || hMax > 30) e.handlingMax = "Use 0 to 30 business days."
  else if (whole(f.handlingMin) && hMin > hMax) e.handlingMax = "The longest time can't be shorter than the shortest."
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.cutoffLocal)) e.cutoffLocal = "Use a time like 14:00."
  if (!(f.workdays & 127)) e.workdays = "Choose at least one day."
  if (f.localPickup && !f.pickupLocationId) e.pickupLocationId = "Choose the store or showroom shoppers collect from."
  if (!f.zones.some((z) => z.enabled)) e.zones = "Turn on at least one zone, or shoppers can't check out."
  const owner = new Map<string, string>()
  f.zones.forEach((z, i) => {
    if (!z.name.trim()) e[`zones.${i}.name`] = "Name the zone."
    if (!z.countries.length) e[`zones.${i}.countries`] = "Choose at least one country."
    for (const c of z.countries) {
      if (c === "*") continue
      if (owner.has(c)) e[`zones.${i}.countries`] = `${countries[c as CountryCode]?.name ?? c} is already in ${owner.get(c)}.`
      else owner.set(c, z.name.trim() || "another zone")
    }
    if (z.enabled && !z.methods.some((m) => m.enabled && m.service !== "pickup")) e[`zones.${i}.methods`] = "Turn on Standard or Express, or turn the zone off."
    z.methods.forEach((m, k) => {
      const at = `zones.${i}.methods.${k}`
      if (!m.label.trim()) e[`${at}.label`] = "Give it a name."
      if (m.service !== "pickup") {
        if (!whole(m.transitMin) || Number(m.transitMin) > 60) e[`${at}.transitMin`] = "Use 0 to 60 days."
        if (!whole(m.transitMax) || Number(m.transitMax) > 60) e[`${at}.transitMax`] = "Use 0 to 60 days."
        else if (whole(m.transitMin) && Number(m.transitMin) > Number(m.transitMax)) e[`${at}.transitMax`] = "The longest time can't be shorter than the shortest."
      }
      if (parseAmount(m.price, cur) === null) e[`${at}.price`] = `Enter a price in ${cur}, or 0 for free.`
      if (m.freeOver.trim()) {
        const t = parseAmount(m.freeOver, cur)
        if (t === null || t === 0) e[`${at}.freeOver`] = `Enter an order amount in ${cur}, or leave it empty.`
      }
    })
  })
  f.closures.forEach((c, i) => {
    if (!isDate(c.dateFrom)) e[`closures.${i}.dateFrom`] = "Choose the first day."
    else if (!isDate(c.dateTo)) e[`closures.${i}.dateTo`] = "Choose the last day."
    else if (c.dateTo < c.dateFrom) e[`closures.${i}.dateTo`] = "The last day can't be before the first."
    else if (daysBetween(c.dateFrom, c.dateTo) > 60) e[`closures.${i}.dateTo`] = "Keep a closure to 60 days or less."
  })
  return e
}

export function toBody(f: ShippingForm, cur: CurrencyCode): ShippingProfileBody {
  return {
    originCountry: f.originCountry,
    originCity: f.originCity.trim(),
    handlingMin: Number(f.handlingMin),
    handlingMax: Number(f.handlingMax),
    cutoffLocal: f.cutoffLocal,
    workdays: f.workdays,
    localPickup: f.localPickup,
    pickupLocationId: f.pickupLocationId,
    zones: f.zones.map((z) => ({
      name: z.name.trim(),
      kind: z.kind,
      countries: z.countries,
      enabled: z.enabled,
      methods: z.methods.map((m) => {
        const rates = [{ minSubtotalMinor: 0, amountMinor: parseAmount(m.price, cur) ?? 0 }]
        const t = m.freeOver.trim() ? parseAmount(m.freeOver, cur) : null
        if (t) rates.push({ minSubtotalMinor: t, amountMinor: 0 })
        for (const r of m.extraRates) if (!rates.some((x) => x.minSubtotalMinor === r.minSubtotalMinor)) rates.push(r)
        return { service: m.service, label: m.label.trim(), enabled: m.enabled, transitMin: m.service === "pickup" ? 0 : Number(m.transitMin), transitMax: m.service === "pickup" ? 0 : Number(m.transitMax), carrierLabel: m.carrierLabel, rates }
      }),
    })),
    closures: f.closures.map((c) => ({ dateFrom: c.dateFrom, dateTo: c.dateTo, reason: c.reason.trim() || null })),
  }
}

/** The zone that covers a destination, as the manual provider picks it. */
export function zoneFor(zones: ZoneForm[], country: string) {
  return zones.find((z) => z.countries.includes(country)) ?? zones.find((z) => z.countries.includes("*")) ?? null
}

export type Preview = { kind: "estimate"; shipBy: string; arrivalFrom: string; arrivalTo: string; service: Service } | { kind: "unavailable"; reason: string } | { kind: "invalid" }

/**
 * The estimate an order placed now would get, from the unsaved form values: the same engine and
 * holiday calendars the server uses (holidays from GET /api/studio/shipping).
 */
export function previewEstimate(f: ShippingForm, d: StudioShippingDto, dest: CountryCode, now: number): Preview {
  const hMin = Number(f.handlingMin)
  const hMax = Number(f.handlingMax)
  if (!whole(f.handlingMin) || !whole(f.handlingMax) || hMin > hMax || hMax > 30 || !(f.workdays & 127) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.cutoffLocal)) return { kind: "invalid" }
  const zone = zoneFor(f.zones, dest)
  const where = countries[dest].name
  if (!zone || !zone.enabled) return { kind: "unavailable", reason: `With these settings, nothing ships to ${where}.` }
  const m = zone.methods.find((x) => x.service === "standard" && x.enabled) ?? zone.methods.find((x) => x.service === "express" && x.enabled)
  if (!m) return { kind: "unavailable", reason: `With these settings, nothing ships to ${where}.` }
  if (!whole(m.transitMin) || !whole(m.transitMax) || Number(m.transitMin) > Number(m.transitMax)) return { kind: "invalid" }
  const origin = d.destinationHolidays[f.originCountry] ?? []
  const closures = f.closures.filter((c) => isDate(c.dateFrom) && isDate(c.dateTo) && c.dateTo >= c.dateFrom).map((c) => ({ from: c.dateFrom, to: c.dateTo }))
  const e = estimateDelivery({
    handlingCal: makeCalendar(f.workdays, origin, closures),
    transitCal: makeCalendar(WEEKDAYS, d.destinationHolidays[dest] ?? []),
    timeZone: zoneTimeZone(f.originCountry, d),
    destTimeZone: zoneTimeZone(dest, d),
    cutoffLocal: f.cutoffLocal,
    handling: [hMin, hMax],
    transit: [Number(m.transitMin), Number(m.transitMax)],
    anchor: { kind: "quote", at: now },
    now,
  })
  if (!e.shipBy || !e.arrivalFrom || !e.arrivalTo) return { kind: "invalid" }
  return { kind: "estimate", shipBy: e.shipBy, arrivalFrom: e.arrivalFrom, arrivalTo: e.arrivalTo, service: m.service }
}

/** Each market's zone (the profile's own for its origin). */
const marketZones: Record<CountryCode, string> = {
  NG: "Africa/Lagos",
  GH: "Africa/Accra",
  KE: "Africa/Nairobi",
  ZA: "Africa/Johannesburg",
  GB: "Europe/London",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  US: "America/New_York",
  MX: "America/Mexico_City",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
}
function zoneTimeZone(c: CountryCode, d: StudioShippingDto) {
  return c === d.profile.originCountry ? d.profile.timeZone : (marketZones[c] ?? "UTC")
}

/** The countries a custom zone can take: every market no other zone holds. */
export function freeCountries(zones: ZoneForm[], self: number) {
  const taken = new Set(zones.flatMap((z, i) => (i === self ? [] : z.countries)))
  return countryCodes.filter((c) => !taken.has(c))
}

export function countriesLabel(list: string[]) {
  if (list.includes("*")) return "Everywhere no other zone covers"
  const names = list.map((c) => countries[c as CountryCode]?.name ?? c)
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ")
}
