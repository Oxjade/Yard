import "server-only"
import { and, asc, eq, inArray } from "drizzle-orm"
import { countries, countryCodes, type CountryCode } from "@/config/markets"
import type { HolidayDto, HolidayRefDto, ShippingProfileBody, StudioShippingDto } from "@/lib/api/contracts/shipping"
import { countryTimeZone } from "@/lib/data/zones"
import { dateIn, isDate, daysBetween } from "@/lib/shipping/calendar"
import type { BrandActor } from "../auth/dal"
import { assertOwned } from "../auth/owned"
import { writeAudit } from "../audit"
import { invalidateMemo, memo } from "../cache"
import { afterCommit, db, inTransaction, withTx } from "../db"
import { brandLocations, brands, holidays, shippingClosures, shippingMethods, shippingProfiles, shippingRates, shippingZones } from "../db/schema"
import { badRequest, notFound } from "../http/errors"
import { newId } from "../ids"
import { carrierProviders, getProvider, type PickupPoint, type ZoneWithMethods } from "./providers"

export type BrandRow = typeof brands.$inferSelect
export type ClosureRow = typeof shippingClosures.$inferSelect

export type BrandShipping = {
  brand: BrandRow
  profile: typeof shippingProfiles.$inferSelect
  zones: ZoneWithMethods[]
  closures: ClosureRow[]
  pickup: PickupPoint | null
}

export type HolidayRow = HolidayDto

const PROFILE_TTL = 30_000
const HOLIDAY_TTL = 60_000

/** Profile and holiday memos (also dropped when a profile is saved or Yard edits holidays). */
export function invalidateShippingCache(brandId?: string) {
  invalidateMemo(brandId ? `shipping:brand:${brandId}` : "shipping:")
}

async function loadPickup(brandId: string, locationId: string | null): Promise<PickupPoint | null> {
  if (!locationId) return null
  const d = await db()
  const row = await d.query.brandLocations.findFirst({
    where: (l, { and, eq, inArray }) => and(eq(l.id, locationId), eq(l.brandId, brandId), inArray(l.kind, ["store", "showroom"]), eq(l.visibility, "published"), eq(l.moderationStatus, "approved")),
  })
  if (!row) return null
  return { id: row.id, name: row.name, area: row.neighbourhood ? `${row.neighbourhood}, ${row.city}` : row.city, citySlug: row.citySlug }
}

async function loadFresh(brandId: string): Promise<BrandShipping | null> {
  const d = await db()
  const [brand, profile] = await Promise.all([d.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, brandId) }), d.query.shippingProfiles.findFirst({ where: (p, { eq }) => eq(p.brandId, brandId) })])
  if (!brand || !profile) return null
  const zones = await d.select().from(shippingZones).where(eq(shippingZones.brandId, brandId)).orderBy(asc(shippingZones.position), asc(shippingZones.name))
  const methods = zones.length ? await d.select().from(shippingMethods).where(inArray(shippingMethods.zoneId, zones.map((z) => z.id))).orderBy(asc(shippingMethods.position)) : []
  const rates = methods.length ? await d.select().from(shippingRates).where(inArray(shippingRates.methodId, methods.map((m) => m.id))).orderBy(asc(shippingRates.minSubtotalMinor)) : []
  const closures = await d.select().from(shippingClosures).where(eq(shippingClosures.brandId, brandId)).orderBy(asc(shippingClosures.dateFrom))
  const pickup = await loadPickup(brandId, profile.pickupLocationId)
  return {
    brand,
    profile,
    zones: zones.map((z) => ({ ...z, methods: methods.filter((m) => m.zoneId === z.id).map((m) => ({ ...m, rates: rates.filter((r) => r.methodId === m.id) })) })),
    closures,
    pickup,
  }
}

/**
 * A brand's shipping setup. Memoised for 30 s outside transactions (the PDP estimate is a hot
 * public read); inside a transaction it always reads through it, so a write sees its own rows.
 */
export function loadBrandShipping(brandId: string, opts: { fresh?: boolean } = {}): Promise<BrandShipping | null> {
  if (opts.fresh || inTransaction()) return loadFresh(brandId)
  return memo(`shipping:brand:${brandId}`, PROFILE_TTL, () => loadFresh(brandId))
}

async function loadHolidays(country: string): Promise<HolidayRow[]> {
  const d = await db()
  const rows = await d.select().from(holidays).where(eq(holidays.country, country)).orderBy(asc(holidays.date))
  return rows.map((h) => ({ date: h.date, name: h.name, country: h.country, kind: h.kind === "carrier" ? "carrier" : "public", estimated: h.estimated }))
}

/** A country's holidays and carrier closures (memoised for 60 s outside transactions). */
export function holidaysFor(country: string): Promise<HolidayRow[]> {
  if (inTransaction()) return loadHolidays(country)
  return memo(`shipping:holidays:${country}`, HOLIDAY_TTL, () => loadHolidays(country))
}

export const toRef = (h: HolidayRow): HolidayRefDto => ({ date: h.date, name: h.name, country: h.country })

/* ---------- Studio: read ---------- */

export async function studioShipping(actor: BrandActor): Promise<StudioShippingDto> {
  const s = await loadBrandShipping(actor.brandId, { fresh: true })
  if (!s) throw notFound("Shipping isn't set up for this brand yet.")
  const d = await db()
  const today = dateIn(s.profile.timeZone, Date.now())
  const origin = (await holidaysFor(s.profile.originCountry)).filter((h) => h.date >= today)
  // The destinations the preview can choose, with their holidays (refs only, a small list).
  const destinationHolidays: Record<string, HolidayRefDto[]> = {}
  for (const c of countryCodes) destinationHolidays[c] = (await holidaysFor(c)).filter((h) => h.date >= today).map(toRef)
  const places = await d
    .select()
    .from(brandLocations)
    .where(and(eq(brandLocations.brandId, actor.brandId), inArray(brandLocations.kind, ["store", "showroom"]), eq(brandLocations.visibility, "published"), eq(brandLocations.moderationStatus, "approved")))
    .orderBy(asc(brandLocations.name))
  const provider = getProvider(s.profile.providerId)
  return {
    brand: { id: s.brand.id, name: s.brand.name, currency: s.brand.currency, country: s.brand.country },
    profile: {
      originCountry: s.profile.originCountry,
      originCity: s.profile.originCity,
      timeZone: s.profile.timeZone,
      handlingMin: s.profile.handlingMin,
      handlingMax: s.profile.handlingMax,
      cutoffLocal: s.profile.cutoffLocal,
      workdays: s.profile.workdays,
      localPickup: s.profile.localPickup,
      pickupLocationId: s.profile.pickupLocationId,
      providerId: s.profile.providerId,
      currency: s.profile.currency,
      updatedAt: s.profile.updatedAt.toISOString(),
      updatedBy: s.profile.updatedBy,
    },
    zones: s.zones.map((z) => ({
      id: z.id,
      name: z.name,
      kind: z.kind as StudioShippingDto["zones"][number]["kind"],
      countries: z.countries,
      enabled: z.enabled,
      methods: z.methods.map((m) => ({
        id: m.id,
        service: m.service as "standard" | "express" | "pickup",
        label: m.label,
        enabled: m.enabled,
        transitMin: m.transitMin,
        transitMax: m.transitMax,
        carrierLabel: m.carrierLabel,
        rates: m.rates.map((r) => ({ id: r.id, minSubtotalMinor: r.minSubtotalMinor, amountMinor: r.amountMinor })),
      })),
    })),
    closures: s.closures.map((c) => ({ id: c.id, dateFrom: c.dateFrom, dateTo: c.dateTo, reason: c.reason })),
    holidays: origin,
    destinationHolidays,
    pickupOptions: places.map((p) => ({ id: p.id, name: p.name, kind: p.kind, area: p.neighbourhood ? `${p.neighbourhood}, ${p.city}` : p.city, citySlug: p.citySlug })),
    provider: { id: provider.id, label: provider.label, kind: provider.kind },
    carriers: carrierProviders().map((c) => ({ id: c.id, label: c.label, configured: c.isConfigured() })),
  }
}

/* ---------- Studio: save (PUT replaces every row) ---------- */

const isCountry = (c: string): c is CountryCode => (countryCodes as string[]).includes(c)

/** Business-rule validation beyond the zod shape. Field paths match the body. */
function validate(body: ShippingProfileBody) {
  const f: Record<string, string> = {}
  if (!isCountry(body.originCountry)) f.originCountry = "Choose one of Yard's markets."
  if (body.handlingMin > body.handlingMax) f.handlingMax = "The longest time can't be shorter than the shortest."
  if (!body.zones.some((z) => z.enabled)) f.zones = "Turn on at least one zone, or shoppers can't check out."
  const names = new Set<string>()
  const owner = new Map<string, string>()
  let wildcard = 0
  body.zones.forEach((z, i) => {
    const key = z.name.trim().toLowerCase()
    if (names.has(key)) f[`zones.${i}.name`] = "Another zone has this name."
    names.add(key)
    z.countries.forEach((c, j) => {
      if (c === "*") {
        wildcard++
        if (z.kind !== "international") f[`zones.${i}.countries.${j}`] = "Only the International zone covers everywhere else."
        return
      }
      if (!isCountry(c)) f[`zones.${i}.countries.${j}`] = "Choose one of Yard's markets."
      else if (owner.has(c)) f[`zones.${i}.countries`] = `${countries[c].name} is already in ${owner.get(c)}.`
      else owner.set(c, z.name.trim())
    })
    const services = new Set<string>()
    z.methods.forEach((m, k) => {
      const at = `zones.${i}.methods.${k}`
      if (services.has(m.service)) f[`${at}.service`] = "This zone already has this service."
      services.add(m.service)
      if (m.transitMin > m.transitMax) f[`${at}.transitMax`] = "The longest time can't be shorter than the shortest."
      const tiers = new Set<number>()
      m.rates.forEach((r, n) => {
        if (tiers.has(r.minSubtotalMinor)) f[`${at}.rates.${n}.minSubtotalMinor`] = "Two prices start at the same order amount."
        tiers.add(r.minSubtotalMinor)
      })
      if (!tiers.has(0)) f[`${at}.rates`] = "Add a price for orders of any size (from 0)."
    })
    if (z.enabled && !z.methods.some((m) => m.enabled && m.service !== "pickup")) f[`zones.${i}.methods`] = "Turn on Standard or Express, or turn the zone off."
  })
  if (wildcard > 1) f.zones = "Only one zone can cover everywhere else."
  if (body.localPickup && !body.pickupLocationId) f.pickupLocationId = "Choose the store or showroom shoppers collect from."
  body.closures.forEach((c, i) => {
    if (!isDate(c.dateFrom)) f[`closures.${i}.dateFrom`] = "Use a real date."
    else if (!isDate(c.dateTo)) f[`closures.${i}.dateTo`] = "Use a real date."
    else if (c.dateTo < c.dateFrom) f[`closures.${i}.dateTo`] = "The last day can't be before the first."
    else if (daysBetween(c.dateFrom, c.dateTo) > 60) f[`closures.${i}.dateTo`] = "Keep a closure to 60 days or less."
  })
  if (Object.keys(f).length) throw badRequest(f)
}

export async function saveShipping(actor: BrandActor, body: ShippingProfileBody, ipHash: string | null) {
  validate(body)
  if (body.pickupLocationId) await assertOwned(actor, [{ kind: "pickupLocation", id: body.pickupLocationId, field: "pickupLocationId" }])
  const brandId = actor.brandId
  const origin = body.originCountry as CountryCode
  await withTx(async () => {
    const d = await db()
    const existing = await d.query.shippingProfiles.findFirst({ where: (p, { eq }) => eq(p.brandId, brandId) })
    const values = {
      originCountry: origin,
      originCity: body.originCity.trim(),
      timeZone: countryTimeZone[origin],
      handlingMin: body.handlingMin,
      handlingMax: body.handlingMax,
      cutoffLocal: body.cutoffLocal,
      workdays: body.workdays,
      localPickup: body.localPickup,
      pickupLocationId: body.pickupLocationId,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }
    if (existing) await d.update(shippingProfiles).set(values).where(eq(shippingProfiles.brandId, brandId))
    else await d.insert(shippingProfiles).values({ brandId, currency: actor.brand.currency, providerId: "manual", ...values })

    // Replace-all: every zone, method, rate and closure gets a fresh id; ids in the body are ignored (§2.6).
    await d.delete(shippingZones).where(eq(shippingZones.brandId, brandId))
    for (const [i, z] of body.zones.entries()) {
      const zoneId = newId("sz")
      await d.insert(shippingZones).values({ id: zoneId, brandId, name: z.name.trim(), kind: z.kind, countries: [...new Set(z.countries)], enabled: z.enabled, position: i })
      for (const [k, m] of z.methods.entries()) {
        const methodId = newId("sm")
        // Pickup has one switch (the profile's localPickup) and is always free, so a zone can't
        // disagree with Dispatch or charge for collecting from the brand's own store.
        const pickup = m.service === "pickup"
        await d.insert(shippingMethods).values({ id: methodId, zoneId, brandId, service: m.service, label: m.label.trim(), enabled: pickup ? body.localPickup : m.enabled, transitMin: pickup ? 0 : m.transitMin, transitMax: pickup ? 0 : m.transitMax, carrierLabel: pickup ? null : m.carrierLabel?.trim() || null, position: k })
        const rates = pickup ? [{ minSubtotalMinor: 0, amountMinor: 0 }] : m.rates
        await d.insert(shippingRates).values(rates.map((r) => ({ id: newId("sr"), methodId, minSubtotalMinor: r.minSubtotalMinor, amountMinor: r.amountMinor, currency: actor.brand.currency })))
      }
    }
    await d.delete(shippingClosures).where(eq(shippingClosures.brandId, brandId))
    if (body.closures.length) await d.insert(shippingClosures).values(body.closures.map((c) => ({ id: newId("cl"), brandId, dateFrom: c.dateFrom, dateTo: c.dateTo, reason: c.reason?.trim() || null })))

    await writeAudit({
      actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
      action: "shipping.profile_updated",
      target: `${actor.brand.name} shipping`,
      subjectType: "shipping_profile",
      subjectId: brandId,
      brandId,
      ipHash,
      meta: { zones: body.zones.length, enabledZones: body.zones.filter((z) => z.enabled).length, handling: [body.handlingMin, body.handlingMax], cutoffLocal: body.cutoffLocal, closures: body.closures.length },
    })
    afterCommit(() => invalidateShippingCache(brandId))
  })
  // Open orders follow the new handling time and closures (outside the save's transaction).
  const { recomputeOpenOrders } = await import("./orders")
  await recomputeOpenOrders(brandId, "profile_changed").catch(() => {})
  return studioShipping(actor)
}

/** The origin holidays from `from` (for the holidays endpoint). */
export async function holidaysBetweenDates(country: string, from?: string, to?: string) {
  const all = await holidaysFor(country)
  return all.filter((h) => (!from || h.date >= from) && (!to || h.date <= to))
}

