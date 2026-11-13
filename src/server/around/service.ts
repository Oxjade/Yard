import "server-only"
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { dateRangeProblems, type LocationEventBody, type LocationEventPatchBody, type LocationPatchBody, type LocationWriteBody, type StudioEventDto, type StudioLocationDto, type WriteOutcome } from "@/lib/api/contracts/around"
import { cities, cityBySlug, haversineKm } from "@/lib/around/gazetteer"
import { otherCityPinProblem } from "@/lib/around/markets"
import { DAYS, toMinutes, type PlaceHours } from "@/lib/around/hours"
import { countryTimeZone } from "@/lib/data/zones"
import type { CountryCode } from "@/config/markets"
import { assertBrandMayPublish, requireBrandResource, type BrandActor } from "../auth/dal"
import { assertOwned, type OwnedRef } from "../auth/owned"
import { writeAudit } from "../audit"
import { afterCommit, db, t, withTx } from "../db"
import { badRequest, conflict, NotImplemented, notFound, rateLimited, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { refreshVisibility } from "../media"
import { hit, recordAbuse } from "../security/rate-limit"
import { getEnv } from "../env"
import { toStudioEvent, toStudioLocation } from "./dto"
import { invalidate } from "./cache"
import { assertUnlocked, changed, changedKeys, decide, EVENT_AUDIT_FIELDS, EVENT_MATERIAL, PLACE_AUDIT_FIELDS, PLACE_MATERIAL, type Moderation, type Visibility } from "./review"

/**
 * Studio Locations (§6.4): brand-scoped reads and the writes behind /api/studio/locations.
 * Every write is one short transaction: validate, check foreign ids (assertOwned), apply the
 * review rules, write, refresh media visibility in the same transaction (§5.4), audit, and drop
 * the public cache after commit. No network or file I/O happens inside.
 */

type PlaceRow = typeof t.brandLocations.$inferSelect
type EventRow = typeof t.locationEvents.$inferSelect
type ImageEntry = { mediaId?: string; src: string; alt: string; width: number; height: number }

/* ---------- Rate ---------- */

/** Around writes: 30 an hour per brand (§5.1). Development allows 240, so the shared test kits can run repeatedly. */
export async function brandWriteRate(actor: BrandActor, ipHash: string | null) {
  const limit = getEnv().dev ? 240 : 30
  const r = hit(`around.write:brand:${actor.brandId}`, limit, 3600)
  if (!r.ok) {
    await recordAbuse(`around.write:brand:${actor.brandId}`, { kind: "brand", id: actor.userId, ipHash }, "around.write", "rate_limit", { limit, windowSec: 3600 }).catch(() => {})
    throw rateLimited(r.retryAfter, "Your team has saved a lot of places this hour. Try again shortly.")
  }
}

/* ---------- Reads ---------- */

async function eventsOf(locationIds: string[]) {
  if (!locationIds.length) return [] as EventRow[]
  const d = await db()
  return d.select().from(t.locationEvents).where(inArray(t.locationEvents.locationId, locationIds)).orderBy(asc(t.locationEvents.startsAt))
}

export async function listLocations(actor: BrandActor): Promise<StudioLocationDto[]> {
  const d = await db()
  const rows = await d.select().from(t.brandLocations).where(eq(t.brandLocations.brandId, actor.brandId)).orderBy(asc(t.brandLocations.createdAt))
  const events = await eventsOf(rows.map((r) => r.id))
  const now = Date.now()
  return rows.map((r) => toStudioLocation(r, events.filter((e) => e.locationId === r.id), now)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Loads a place scoped to the session's active brand (another brand's place is 404, §2.2). */
export async function loadOwnPlace(id: string) {
  return requireBrandResource(async (brandId) => {
    const d = await db()
    const [row] = await d.select().from(t.brandLocations).where(and(eq(t.brandLocations.id, id), eq(t.brandLocations.brandId, brandId))).limit(1)
    return row ?? null
  }, "locations.manage")
}

/**
 * The row as it is inside the write's transaction. The first load (loadOwnPlace) runs before the
 * transaction to authorise; an admin decision can commit between the two, so every write re-reads
 * here, re-checks the lock, and compares what it read in the UPDATE's where clause (§1.3).
 */
async function placeInTx(id: string, brandId: string) {
  const d = await db()
  const [row] = await d.select().from(t.brandLocations).where(and(eq(t.brandLocations.id, id), eq(t.brandLocations.brandId, brandId))).limit(1)
  if (!row) throw notFound()
  return row
}

async function eventInTx(id: string, locationId: string, brandId: string) {
  const d = await db()
  const [row] = await d
    .select()
    .from(t.locationEvents)
    .where(and(eq(t.locationEvents.id, id), eq(t.locationEvents.locationId, locationId), eq(t.locationEvents.brandId, brandId)))
    .limit(1)
  if (!row) throw notFound()
  return row
}

/** updated_at still equals what the write read (compared to the millisecond, as JS reads it). */
const sameInstant = (col: typeof t.brandLocations.updatedAt | typeof t.locationEvents.updatedAt, at: Date): SQL => sql`date_trunc('milliseconds', ${col}) = ${at.toISOString()}::timestamptz`

const CHANGED = "This place changed. Reload and try again."

export async function getLocation(id: string, permission: "locations.manage" | "any_member" = "any_member") {
  const { actor, resource } = await requireBrandResource(async (brandId) => {
    const d = await db()
    const [row] = await d.select().from(t.brandLocations).where(and(eq(t.brandLocations.id, id), eq(t.brandLocations.brandId, brandId))).limit(1)
    return row ?? null
  }, permission)
  return { actor, location: toStudioLocation(resource, await eventsOf([resource.id]), Date.now()) }
}

/* ---------- Validation ---------- */

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "city"

type Resolved = { city: string; citySlug: string; country: string; timeZone: string; inGazetteer: boolean; neighbourhood: string | null; centre: { lat: number; lng: number } | null }

type CityInput = { inGazetteer?: boolean; citySlug?: string | null; neighbourhoodSlug?: string | null; neighbourhoodName?: string | null; cityName?: string | null; country?: string | null }

function resolveCity(input: CityInput, fields: Record<string, string>): Resolved | null {
  if (input.inGazetteer !== false) {
    const city = input.citySlug ? cityBySlug(input.citySlug) : null
    if (!city) {
      fields.citySlug = "Choose a city from the list, or choose Other city."
      return null
    }
    let neighbourhood: string | null = null
    if (input.neighbourhoodSlug) {
      const hood = city.neighbourhoods.find((h) => h.slug === input.neighbourhoodSlug)
      if (!hood) fields.neighbourhoodSlug = `Choose a ${city.name} neighbourhood, or Other.`
      else neighbourhood = hood.name
    } else if (input.neighbourhoodName?.trim()) neighbourhood = input.neighbourhoodName.trim()
    return { city: city.name, citySlug: city.slug, country: city.country, timeZone: city.timeZone, inGazetteer: true, neighbourhood, centre: { lat: city.lat, lng: city.lng } }
  }
  const name = input.cityName?.trim() ?? ""
  const country = input.country ?? ""
  if (!name) fields.cityName = "Name the city."
  if (!country || !(country in countryTimeZone)) fields.country = "Choose the country."
  if (!name || !country || !(country in countryTimeZone)) return null
  const slug = slugify(name)
  const listed = cities.find((c) => c.slug === slug || c.name.toLowerCase() === name.toLowerCase() || c.aliases.some((a) => a.toLowerCase() === name.toLowerCase()))
  if (listed) {
    fields.cityName = `${listed.name} is on Yard Around's list. Choose it under City.`
    return null
  }
  return { city: name, citySlug: slug, country, timeZone: countryTimeZone[country as CountryCode], inGazetteer: false, neighbourhood: input.neighbourhoodName?.trim() || null, centre: null }
}

function checkPin(r: Resolved, lat: number, lng: number, fields: Record<string, string>) {
  if (r.inGazetteer && r.centre && haversineKm(lat, lng, r.centre.lat, r.centre.lng) > 60) fields.lat = `That pin is outside ${r.city}. Move it or change the city.`
  // Other city (§6.4): the pin has to leave the gazetteer centre it starts on, stay more than 60 km
  // from every covered city (that place should choose the city), and sit inside the chosen country.
  if (!r.inGazetteer) {
    const problem = otherCityPinProblem({ cityName: r.city, country: r.country, lat, lng })
    if (problem) fields.lat = problem
  }
}

function checkHours(hours: PlaceHours | null | undefined, fields: Record<string, string>) {
  if (!hours) return
  for (const d of DAYS) {
    for (const [o, c] of hours[d] ?? []) {
      if (c !== "24:00" && toMinutes(c) <= toMinutes(o)) fields[`hours.${d}`] = "Closing time must be after opening time."
    }
  }
}

function checkDates(kind: string, startsAt: Date | null, endsAt: Date | null, publishing: boolean, fields: Record<string, string>, datesWritten: boolean, word = kind === "exhibition" ? "Exhibitions" : "Pop-ups") {
  if (!startsAt) fields.startsAt = `${word} need a start date and time.`
  if (!endsAt) fields.endsAt = `${word} need an end date and time.`
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) fields.endsAt = "The end has to come after the start."
  else if (publishing && endsAt && endsAt.getTime() <= Date.now()) fields.endsAt = "This end time has passed. Choose new dates to publish."
  // Range rules apply to dates being written, so an old ended pop-up can still be renamed or hidden.
  if (datesWritten && startsAt && endsAt) for (const [k, v] of Object.entries(dateRangeProblems(startsAt.getTime(), endsAt.getTime(), Date.now(), word))) fields[k] ??= v
}

/** Media ids → image entries, each checked by assertOwned (§2.6); the server builds every src. */
async function imagesFrom(actor: BrandActor, refs: { mediaId: string; alt: string }[], field: string): Promise<ImageEntry[]> {
  if (!refs.length) return []
  const owned: OwnedRef[] = refs.map((r, i) => ({ kind: "media", id: r.mediaId, field: refs.length === 1 && field === "image" ? "image.mediaId" : `${field}.${i}.mediaId`, purpose: "location_image" }))
  await assertOwned(actor, owned)
  const d = await db()
  const rows = await d.select().from(t.mediaAssets).where(and(inArray(t.mediaAssets.id, refs.map((r) => r.mediaId)), eq(t.mediaAssets.brandId, actor.brandId)))
  return refs.map((r) => {
    const m = rows.find((x) => x.id === r.mediaId)!
    return { mediaId: m.id, src: `/api/media/${encodeURIComponent(m.id)}`, alt: r.alt.trim(), width: m.width ?? 1200, height: m.height ?? 900 }
  })
}

const mediaIdsOf = (images: (ImageEntry | null | undefined)[]) => images.flatMap((i) => (i?.mediaId ? [i.mediaId] : []))

/** media.refreshVisibility in the same transaction (§5.4). Before F2's implementation lands, uploads simply stay private. */
async function refreshMedia(ids: string[]) {
  const list = [...new Set(ids)]
  if (!list.length) return
  try {
    await refreshVisibility(list)
  } catch (e) {
    if (e instanceof NotImplemented) {
      log.once("around:media-visibility", "warn", "[yard] media.refreshVisibility isn't implemented yet: place photos stay private until it is.")
      return
    }
    throw e
  }
}

const auditActor = (a: BrandActor) => ({ kind: "brand" as const, id: a.userId, name: a.name, role: a.role })
const verified = (a: BrandActor) => a.brand.reviewStatus === "verified"

async function auditOutcome(actor: BrandActor, subject: "location" | "location_event", id: string, name: string, outcome: WriteOutcome, ipHash: string | null, fields: string[] = []) {
  const action = outcome === "published" ? "published" : outcome === "submitted" || outcome === "resubmitted" ? "submitted_for_review" : outcome === "hidden" ? "hidden" : null
  if (!action) return false
  await writeAudit({ actor: auditActor(actor), action: `${subject}.${action}`, target: name, subjectType: subject, subjectId: id, brandId: actor.brandId, ipHash, ...(fields.length ? { meta: { fields } } : {}) })
  return true
}

/**
 * The audit trail of an edit. A visibility or review change writes its outcome row; any other
 * edit to a row that is (or was) published writes `<subject>.updated`. Either way meta names the
 * changed fields, never their values, so public text never changes without a trace.
 */
async function auditEdit(
  actor: BrandActor,
  subject: "location" | "location_event",
  row: { id: string; label: string },
  input: { outcome: WriteOutcome; statusChanged: boolean; material: boolean; wasOrIsPublished: boolean; fields: string[] },
  ipHash: string | null,
) {
  const wrote = input.statusChanged || input.material ? await auditOutcome(actor, subject, row.id, row.label, input.outcome, ipHash, input.fields) : false
  if (!wrote && input.wasOrIsPublished && input.fields.length)
    await writeAudit({ actor: auditActor(actor), action: `${subject}.updated`, target: row.label, subjectType: subject, subjectId: row.id, brandId: actor.brandId, ipHash, meta: { fields: input.fields } })
}

/**
 * When a new place or event reuses a photo of, or (for a place) the name and address of, a row
 * Yard rejected or removed, it carries that row's reviewed_at, so Add location can't sidestep the
 * review a Duplicate would get (§6.4).
 */
async function priorDecision(brandId: string, input: { mediaIds: string[]; name?: string; addressLine?: string }): Promise<Date | null> {
  const d = await db()
  const decided = ["rejected", "removed"]
  const ids = new Set(input.mediaIds)
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  const places = await d
    .select({ images: t.brandLocations.images, name: t.brandLocations.name, addressLine: t.brandLocations.addressLine, reviewedAt: t.brandLocations.reviewedAt })
    .from(t.brandLocations)
    .where(and(eq(t.brandLocations.brandId, brandId), inArray(t.brandLocations.moderationStatus, decided)))
  const place = places.find(
    (r) => (r.images ?? []).some((i) => !!i.mediaId && ids.has(i.mediaId)) || (!!input.name && !!input.addressLine && same(r.name, input.name) && same(r.addressLine, input.addressLine)),
  )
  if (place) return place.reviewedAt ?? new Date()
  if (!ids.size) return null
  const events = await d
    .select({ image: t.locationEvents.image, reviewedAt: t.locationEvents.reviewedAt })
    .from(t.locationEvents)
    .where(and(eq(t.locationEvents.brandId, brandId), inArray(t.locationEvents.moderationStatus, decided)))
  const ev = events.find((e) => !!e.image?.mediaId && ids.has(e.image.mediaId))
  return ev ? (ev.reviewedAt ?? new Date()) : null
}

/* ---------- Places ---------- */

type PlaceDraft = {
  kind: string
  name: string
  description: string | null
  addressLine: string
  postcode: string | null
  lat: number
  lng: number
  pinPrecision: string
  hours: PlaceHours | null
  byAppointment: boolean
  hoursNote: string | null
  startsAt: Date | null
  endsAt: Date | null
  featuredProductIds: string[]
  visibility: Visibility
}

const toDate = (s: string | null | undefined) => (s ? new Date(s) : null)
const dated = (kind: string) => kind === "popup" || kind === "exhibition"

async function validatePlace(actor: BrandActor, draft: PlaceDraft, city: Resolved | null, fields: Record<string, string>, datesWritten: boolean) {
  if (city) checkPin(city, draft.lat, draft.lng, fields)
  if (dated(draft.kind)) checkDates(draft.kind, draft.startsAt, draft.endsAt, draft.visibility === "published", fields, datesWritten)
  else checkHours(draft.hours, fields)
  if (Object.keys(fields).length) throw badRequest(fields)
  await assertOwned(
    actor,
    draft.featuredProductIds.map((id, i) => ({ kind: "product" as const, id, field: `featuredProductIds.${i}` })),
  )
}

function normalise(draft: PlaceDraft): PlaceDraft {
  return dated(draft.kind)
    ? { ...draft, hours: null, byAppointment: false }
    : { ...draft, startsAt: null, endsAt: null, hours: draft.byAppointment && !draft.hours ? null : draft.hours }
}

export async function createLocation(actor: BrandActor, body: LocationWriteBody & { images: { mediaId: string; alt: string }[]; featuredProductIds: string[] }, ipHash: string | null) {
  const visibility = (body.visibility ?? "draft") as Visibility
  if (visibility === "published") assertBrandMayPublish(actor)
  return withTx(async () => {
    const fields: Record<string, string> = {}
    const city = resolveCity(body, fields)
    const draft = normalise({
      kind: body.kind,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      addressLine: body.addressLine.trim(),
      postcode: body.postcode?.trim() || null,
      lat: body.lat,
      lng: body.lng,
      pinPrecision: body.pinPrecision ?? "area",
      hours: (body.hours as PlaceHours | null | undefined) ?? null,
      byAppointment: body.byAppointment ?? false,
      hoursNote: body.hoursNote?.trim() || null,
      startsAt: toDate(body.startsAt),
      endsAt: toDate(body.endsAt),
      featuredProductIds: body.featuredProductIds ?? [],
      visibility,
    })
    await validatePlace(actor, draft, city, fields, true)
    if (!city) throw badRequest(fields)
    const images = await imagesFrom(actor, body.images ?? [], "images")
    const reviewedAt = await priorDecision(actor.brandId, { mediaIds: mediaIdsOf(images), name: draft.name, addressLine: draft.addressLine })
    const { moderationStatus, outcome } = decide({ subject: "place", brandVerified: verified(actor), prev: null, reviewedAt, nextVisibility: visibility, material: true })
    const d = await db()
    const now = new Date()
    const [row] = await d
      .insert(t.brandLocations)
      .values({
        id: newId("loc"),
        brandId: actor.brandId,
        ...draft,
        city: city.city,
        citySlug: city.citySlug,
        country: city.country,
        timeZone: city.timeZone,
        inGazetteer: city.inGazetteer,
        neighbourhood: city.neighbourhood,
        images,
        moderationStatus,
        reviewedAt,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
        publishedAt: visibility === "published" ? now : null,
      })
      .returning()
    await refreshMedia(mediaIdsOf(images))
    await auditOutcome(actor, "location", row.id, row.name, outcome, ipHash)
    afterCommit(invalidate)
    return { location: toStudioLocation(row, [], Date.now()), outcome }
  })
}

const cityKeys = ["inGazetteer", "citySlug", "neighbourhoodSlug", "neighbourhoodName", "cityName", "country"] as const

export async function updateLocation(id: string, body: LocationPatchBody, ipHash: string | null) {
  const { actor, resource: first } = await loadOwnPlace(id)
  assertUnlocked("place", first)
  if ((body.visibility ?? first.visibility) === "published") assertBrandMayPublish(actor)
  return withTx(async () => {
    const prev = await placeInTx(first.id, actor.brandId)
    assertUnlocked("place", prev)
    const visibility = (body.visibility ?? prev.visibility) as Visibility
    const fields: Record<string, string> = {}
    const cityTouched = cityKeys.some((k) => body[k] !== undefined)
    let city: Resolved | null = null
    if (cityTouched) {
      const inGaz = body.inGazetteer ?? prev.inGazetteer
      const prevHood = prev.inGazetteer ? cityBySlug(prev.citySlug)?.neighbourhoods.find((h) => h.name === prev.neighbourhood) : undefined
      city = resolveCity(
        {
          inGazetteer: inGaz,
          citySlug: body.citySlug !== undefined ? body.citySlug : prev.inGazetteer ? prev.citySlug : null,
          neighbourhoodSlug: body.neighbourhoodSlug !== undefined ? body.neighbourhoodSlug : body.neighbourhoodName !== undefined ? null : (prevHood?.slug ?? null),
          neighbourhoodName: body.neighbourhoodName !== undefined ? body.neighbourhoodName : prevHood ? null : prev.neighbourhood,
          cityName: body.cityName !== undefined ? body.cityName : prev.inGazetteer ? null : prev.city,
          country: body.country !== undefined ? body.country : prev.inGazetteer ? null : prev.country,
        },
        fields,
      )
    } else {
      const g = prev.inGazetteer ? cityBySlug(prev.citySlug) : null
      city = { city: prev.city, citySlug: prev.citySlug, country: prev.country, timeZone: prev.timeZone, inGazetteer: prev.inGazetteer, neighbourhood: prev.neighbourhood, centre: g ? { lat: g.lat, lng: g.lng } : null }
    }
    const pick = <K extends keyof LocationPatchBody, V>(k: K, fallback: V): V => (body[k] !== undefined ? (body[k] as unknown as V) : fallback)
    const draft = normalise({
      kind: pick("kind", prev.kind),
      name: pick("name", prev.name),
      description: pick("description", prev.description),
      addressLine: pick("addressLine", prev.addressLine),
      postcode: body.postcode !== undefined ? body.postcode?.trim() || null : prev.postcode,
      lat: pick("lat", prev.lat),
      lng: pick("lng", prev.lng),
      pinPrecision: pick("pinPrecision", prev.pinPrecision),
      hours: pick("hours", prev.hours ?? null),
      byAppointment: pick("byAppointment", prev.byAppointment),
      hoursNote: pick("hoursNote", prev.hoursNote),
      startsAt: body.startsAt !== undefined ? toDate(body.startsAt) : prev.startsAt,
      endsAt: body.endsAt !== undefined ? toDate(body.endsAt) : prev.endsAt,
      featuredProductIds: pick("featuredProductIds", prev.featuredProductIds),
      visibility,
    })
    // The range rules check dates that change; a form re-sending the saved dates of an old pop-up isn't a new date.
    const datesWritten = draft.startsAt?.getTime() !== prev.startsAt?.getTime() || draft.endsAt?.getTime() !== prev.endsAt?.getTime() || draft.kind !== prev.kind
    await validatePlace(actor, draft, city, fields, datesWritten)
    if (!city) throw badRequest(fields)
    const images = body.images !== undefined ? await imagesFrom(actor, body.images, "images") : prev.images
    const next = { ...draft, city: city.city, citySlug: city.citySlug, neighbourhood: city.neighbourhood, images }
    const before = prev as unknown as Record<string, unknown>
    const after = next as unknown as Record<string, unknown>
    const material = changed(before, after, PLACE_MATERIAL)
    const fieldsChanged = changedKeys(before, after, PLACE_AUDIT_FIELDS)
    const { moderationStatus, outcome } = decide({
      subject: "place",
      brandVerified: verified(actor),
      prev: { visibility: prev.visibility as Visibility, moderationStatus: prev.moderationStatus as Moderation, moderationReason: prev.moderationReason, reviewedAt: prev.reviewedAt },
      reviewedAt: prev.reviewedAt,
      nextVisibility: visibility,
      material,
    })
    const d = await db()
    const now = new Date()
    const [row] = await d
      .update(t.brandLocations)
      .set({
        ...next,
        country: city.country,
        timeZone: city.timeZone,
        inGazetteer: city.inGazetteer,
        moderationStatus,
        // A place taken off Around keeps no stale review reason; Yard's own decisions keep theirs.
        moderationReason: moderationStatus === "approved" ? null : prev.moderationReason,
        updatedAt: now,
        publishedAt: visibility === "published" && prev.visibility !== "published" ? now : prev.publishedAt,
      })
      .where(
        and(
          eq(t.brandLocations.id, prev.id),
          eq(t.brandLocations.brandId, actor.brandId),
          eq(t.brandLocations.moderationStatus, prev.moderationStatus),
          sameInstant(t.brandLocations.updatedAt, prev.updatedAt),
        ),
      )
      .returning()
    if (!row) throw conflict(CHANGED)
    // An event photo is public only while its place is published and approved (§5.4), so every
    // place write refreshes the events' photos too, not only the place's own.
    const events = await eventsOf([row.id])
    await refreshMedia([...mediaIdsOf(prev.images), ...mediaIdsOf(images), ...mediaIdsOf(events.map((e) => e.image))])
    await auditEdit(
      actor,
      "location",
      { id: row.id, label: row.name },
      { outcome, statusChanged: prev.visibility !== visibility || prev.moderationStatus !== moderationStatus, material, wasOrIsPublished: prev.visibility === "published" || visibility === "published", fields: fieldsChanged },
      ipHash,
    )
    afterCommit(invalidate)
    return { location: toStudioLocation(row, events, Date.now()), outcome }
  })
}

export async function deleteLocation(id: string, ipHash: string | null) {
  const { actor, resource: prev } = await loadOwnPlace(id)
  return withTx(async () => {
    const d = await db()
    const [pickup] = await d.select({ brandId: t.shippingProfiles.brandId }).from(t.shippingProfiles).where(eq(t.shippingProfiles.pickupLocationId, prev.id)).limit(1)
    if (pickup) throw rule("This place is your local pickup point. Choose another one in Shipping & fulfilment first.")
    const events = await eventsOf([prev.id])
    await d.delete(t.brandLocations).where(and(eq(t.brandLocations.id, prev.id), eq(t.brandLocations.brandId, actor.brandId)))
    await refreshMedia([...mediaIdsOf(prev.images), ...mediaIdsOf(events.map((e) => e.image))])
    await writeAudit({ actor: auditActor(actor), action: "location.deleted", target: prev.name, subjectType: "location", subjectId: prev.id, brandId: actor.brandId, ipHash })
    afterCommit(invalidate)
    return { ok: true as const, id: prev.id }
  })
}

const WEEK = 7 * 86_400_000

const REMOVED_NO_DUPLICATE = "Yard removed this place, so it can't be duplicated. You can delete it."

export async function duplicateLocation(id: string, body: { startsAt?: string; endsAt?: string }, ipHash: string | null) {
  const { actor, resource: first } = await loadOwnPlace(id)
  if (first.moderationStatus === "removed") throw rule(REMOVED_NO_DUPLICATE)
  return withTx(async () => {
    // Re-read inside the transaction: a removal that committed after the first load still blocks it.
    const src = await placeInTx(first.id, actor.brandId)
    if (src.moderationStatus === "removed") throw rule(REMOVED_NO_DUPLICATE)
    let startsAt = src.startsAt
    let endsAt = src.endsAt
    if (dated(src.kind)) {
      if (body.startsAt && body.endsAt) {
        startsAt = new Date(body.startsAt)
        endsAt = new Date(body.endsAt)
        if (endsAt.getTime() <= startsAt.getTime()) throw badRequest({ endsAt: "The end has to come after the start." })
        const range = dateRangeProblems(startsAt.getTime(), endsAt.getTime(), Date.now(), src.kind === "exhibition" ? "Exhibitions" : "Pop-ups")
        if (Object.keys(range).length) throw badRequest(range)
      } else if (startsAt && endsAt && endsAt.getTime() <= Date.now()) {
        // An ended pop-up comes back on the same weekday and time, in the first week still ahead.
        const weeks = Math.ceil((Date.now() - startsAt.getTime()) / WEEK) || 1
        startsAt = new Date(startsAt.getTime() + weeks * WEEK)
        endsAt = new Date(endsAt.getTime() + weeks * WEEK)
      }
    }
    const d = await db()
    const now = new Date()
    const name = `${src.name} (copy)`.slice(0, 80)
    const { tileKey, ...copy } = src
    void tileKey
    const [row] = await d
      .insert(t.brandLocations)
      .values({
        ...copy,
        id: newId("loc"),
        name,
        startsAt,
        endsAt,
        visibility: "draft",
        moderationStatus: "approved",
        moderationReason: null,
        // Duplicate copies reviewed_at, so a copy of a reviewed, rejected or removed place is reviewed when published (§6.4).
        reviewedAt: src.reviewedAt,
        // A copy is the brand's own place from now on, never seed sample data.
        sample: false,
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
        publishedAt: null,
      })
      .returning()
    await writeAudit({ actor: auditActor(actor), action: "location.duplicated", target: name, subjectType: "location", subjectId: row.id, brandId: actor.brandId, ipHash, meta: { sourceId: src.id } })
    return { location: toStudioLocation(row, [], Date.now()), outcome: "draft" as WriteOutcome }
  })
}

/* ---------- Events ---------- */

type EventDraft = { kind: string; title: string; description: string | null; startsAt: Date; endsAt: Date; dropId: string | null; productIds: string[]; promoText: string | null; visibility: Visibility }

async function validateEvent(actor: BrandActor, draft: EventDraft, datesWritten: boolean) {
  const fields: Record<string, string> = {}
  if (draft.endsAt.getTime() <= draft.startsAt.getTime()) fields.endsAt = "The end has to come after the start."
  else if (draft.visibility === "published" && draft.endsAt.getTime() <= Date.now()) fields.endsAt = "This end time has passed. Choose new dates to publish."
  if (datesWritten) for (const [k, v] of Object.entries(dateRangeProblems(draft.startsAt.getTime(), draft.endsAt.getTime(), Date.now(), "Events"))) fields[k] ??= v
  if (Object.keys(fields).length) throw badRequest(fields)
  const refs: OwnedRef[] = draft.productIds.map((id, i) => ({ kind: "product", id, field: `productIds.${i}` }))
  if (draft.dropId) refs.push({ kind: "drop", id: draft.dropId, field: "dropId" })
  await assertOwned(actor, refs)
}

async function loadOwnEvent(locationId: string, eventId: string) {
  const { actor, resource: place } = await loadOwnPlace(locationId)
  const d = await db()
  const [ev] = await d
    .select()
    .from(t.locationEvents)
    .where(and(eq(t.locationEvents.id, eventId), eq(t.locationEvents.locationId, place.id), eq(t.locationEvents.brandId, actor.brandId)))
    .limit(1)
  if (!ev) throw notFound()
  return { actor, place, event: ev }
}

async function eventResult(place: PlaceRow, event: EventRow, outcome?: WriteOutcome): Promise<{ event: StudioEventDto; location: StudioLocationDto; outcome?: WriteOutcome }> {
  const now = Date.now()
  return { event: toStudioEvent(event, now), location: toStudioLocation(place, await eventsOf([place.id]), now), ...(outcome ? { outcome } : {}) }
}

export async function createEvent(locationId: string, body: LocationEventBody & { productIds: string[] }, ipHash: string | null) {
  const { actor, resource: first } = await loadOwnPlace(locationId)
  assertUnlocked("place", first)
  const visibility = (body.visibility ?? "draft") as Visibility
  if (visibility === "published") assertBrandMayPublish(actor)
  return withTx(async () => {
    // The place lock, as it is inside the transaction (an admin may have removed it meanwhile).
    const place = await placeInTx(first.id, actor.brandId)
    assertUnlocked("place", place)
    const draft: EventDraft = {
      kind: body.kind,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      dropId: body.dropId || null,
      productIds: body.productIds ?? [],
      promoText: body.promoText?.trim() || null,
      visibility,
    }
    await validateEvent(actor, draft, true)
    const image = body.image ? ((await imagesFrom(actor, [body.image], "image"))[0] ?? null) : null
    const reviewedAt = await priorDecision(actor.brandId, { mediaIds: mediaIdsOf([image]) })
    const { moderationStatus, outcome } = decide({ subject: "event", brandVerified: verified(actor), prev: null, reviewedAt, nextVisibility: visibility, material: true })
    const d = await db()
    const now = new Date()
    const [row] = await d
      .insert(t.locationEvents)
      .values({ id: newId("lev"), brandId: actor.brandId, locationId: place.id, ...draft, image, moderationStatus, reviewedAt, createdBy: actor.userId, createdAt: now, updatedAt: now })
      .returning()
    await refreshMedia(mediaIdsOf([image]))
    await auditOutcome(actor, "location_event", row.id, row.title, outcome, ipHash)
    afterCommit(invalidate)
    return eventResult(place, row, outcome)
  })
}

export async function updateEvent(locationId: string, eventId: string, body: LocationEventPatchBody, ipHash: string | null) {
  const { actor, place: firstPlace, event: firstEvent } = await loadOwnEvent(locationId, eventId)
  assertUnlocked("place", firstPlace)
  assertUnlocked("event", firstEvent)
  if ((body.visibility ?? firstEvent.visibility) === "published") assertBrandMayPublish(actor)
  return withTx(async () => {
    const place = await placeInTx(firstPlace.id, actor.brandId)
    const prev = await eventInTx(firstEvent.id, place.id, actor.brandId)
    assertUnlocked("place", place)
    assertUnlocked("event", prev)
    const visibility = (body.visibility ?? prev.visibility) as Visibility
    const draft: EventDraft = {
      kind: body.kind ?? prev.kind,
      title: body.title !== undefined ? body.title.trim() : prev.title,
      description: body.description !== undefined ? body.description?.trim() || null : prev.description,
      startsAt: body.startsAt !== undefined ? new Date(body.startsAt) : prev.startsAt,
      endsAt: body.endsAt !== undefined ? new Date(body.endsAt) : prev.endsAt,
      dropId: body.dropId !== undefined ? body.dropId || null : prev.dropId,
      productIds: body.productIds !== undefined ? body.productIds : prev.productIds,
      promoText: body.promoText !== undefined ? body.promoText?.trim() || null : prev.promoText,
      visibility,
    }
    await validateEvent(actor, draft, draft.startsAt.getTime() !== prev.startsAt.getTime() || draft.endsAt.getTime() !== prev.endsAt.getTime())
    const image = body.image !== undefined ? (body.image ? ((await imagesFrom(actor, [body.image], "image"))[0] ?? null) : null) : prev.image
    const next = { ...draft, image }
    const before = prev as unknown as Record<string, unknown>
    const after = next as unknown as Record<string, unknown>
    const material = changed(before, after, EVENT_MATERIAL)
    const fieldsChanged = changedKeys(before, after, EVENT_AUDIT_FIELDS)
    const { moderationStatus, outcome } = decide({
      subject: "event",
      brandVerified: verified(actor),
      prev: { visibility: prev.visibility as Visibility, moderationStatus: prev.moderationStatus as Moderation, moderationReason: prev.moderationReason, reviewedAt: prev.reviewedAt },
      reviewedAt: prev.reviewedAt,
      nextVisibility: visibility,
      material,
    })
    const d = await db()
    const [row] = await d
      .update(t.locationEvents)
      .set({ ...next, moderationStatus, moderationReason: moderationStatus === "approved" ? null : prev.moderationReason, updatedAt: new Date() })
      .where(
        and(
          eq(t.locationEvents.id, prev.id),
          eq(t.locationEvents.brandId, actor.brandId),
          eq(t.locationEvents.moderationStatus, prev.moderationStatus),
          sameInstant(t.locationEvents.updatedAt, prev.updatedAt),
        ),
      )
      .returning()
    if (!row) throw conflict("This event changed. Reload and try again.")
    await refreshMedia(mediaIdsOf([prev.image, image]))
    await auditEdit(
      actor,
      "location_event",
      { id: row.id, label: row.title },
      { outcome, statusChanged: prev.visibility !== visibility || prev.moderationStatus !== moderationStatus, material, wasOrIsPublished: prev.visibility === "published" || visibility === "published", fields: fieldsChanged },
      ipHash,
    )
    afterCommit(invalidate)
    return eventResult(place, row, outcome)
  })
}

export async function deleteEvent(locationId: string, eventId: string, ipHash: string | null) {
  const { actor, place, event: prev } = await loadOwnEvent(locationId, eventId)
  return withTx(async () => {
    const d = await db()
    await d.delete(t.locationEvents).where(and(eq(t.locationEvents.id, prev.id), eq(t.locationEvents.brandId, actor.brandId)))
    await refreshMedia(mediaIdsOf([prev.image]))
    await writeAudit({ actor: auditActor(actor), action: "location_event.deleted", target: prev.title, subjectType: "location_event", subjectId: prev.id, brandId: actor.brandId, ipHash })
    afterCommit(invalidate)
    return { location: toStudioLocation(place, await eventsOf([place.id]), Date.now()) }
  })
}
