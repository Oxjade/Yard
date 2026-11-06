import "server-only"
import type { BrandPlaceBadgeDto, PlaceDetailDto, PlaceEventDto, PlaceImageDto, PlaceSummaryDto, StudioEventDto, StudioLocationDto, StudioPlaceStatus } from "@/lib/api/contracts/around"
import { cityBySlug } from "@/lib/around/gazetteer"
import { brandCategoryName, safePlaceSrc } from "@/lib/around/labels"
import { brandById } from "@/lib/data/brands"
import { drops } from "@/lib/data/catalog"
import { productById } from "@/lib/data/products"
import type { t } from "../db"
import { eventStillPublic, type PublicEventRow, type PublicPlaceRow } from "./public"

/** Response DTOs (§1.10): built here, never a raw row. */

type PlaceRow = typeof t.brandLocations.$inferSelect
type EventRow = typeof t.locationEvents.$inferSelect

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function brandDto(brandId: string) {
  const b = brandById.get(brandId)
  return {
    id: brandId,
    handle: b?.handle ?? brandId,
    name: b?.name ?? "A Yard brand",
    verified: b?.verified ?? false,
    mark: { text: b?.mark.text ?? "Y", style: b?.mark.style ?? "grotesk" },
  }
}

/** Only server-built or seed paths survive (§2.6); anything else is dropped, never rendered. */
function cleanImages(images: PlaceRow["images"], as?: "brand"): PlaceImageDto[] {
  const out: PlaceImageDto[] = []
  for (const im of images ?? []) {
    const src = safePlaceSrc(im.src)
    if (!src) continue
    out.push({ ...(im.mediaId ? { mediaId: im.mediaId } : {}), src: as && im.mediaId ? `${src}?as=${as}` : src, alt: im.alt, width: im.width, height: im.height })
  }
  return out
}

function cleanImage(image: EventRow["image"], as?: "brand"): PlaceImageDto | null {
  return image ? (cleanImages([image], as)[0] ?? null) : null
}

/** The next live-or-upcoming public event, and whether any of them carries a drop or promo. */
function eventFacts(events: PublicEventRow[], now: number) {
  const live = events.filter((e) => eventStillPublic(e, now)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  const next = live[0]
  return {
    nextEvent: next ? { id: next.id, title: next.title, startsAt: next.startsAt.toISOString(), endsAt: next.endsAt.toISOString(), kind: next.kind as PlaceEventDto["kind"], hasDrop: !!next.dropId, hasPromo: !!next.promoText } : undefined,
    offer: live.some((e) => !!e.dropId || !!e.promoText),
    events: live,
  }
}

export function toPlaceSummary(p: PublicPlaceRow | PlaceRow, events: PublicEventRow[], now: number): PlaceSummaryDto {
  const b = brandById.get(p.brandId)
  const facts = eventFacts(events, now)
  const images = cleanImages(p.images)
  return {
    id: p.id,
    brand: brandDto(p.brandId),
    brandCategory: b ? brandCategoryName(b) : "Independent brand",
    brandCategories: b ? [...b.categories] : [],
    kind: p.kind as PlaceSummaryDto["kind"],
    name: p.name,
    neighbourhood: p.neighbourhood,
    city: p.city,
    citySlug: p.citySlug,
    country: p.country,
    inGazetteer: p.inGazetteer,
    lat: p.lat,
    lng: p.lng,
    pinPrecision: p.pinPrecision as PlaceSummaryDto["pinPrecision"],
    timeZone: p.timeZone,
    hours: p.hours ?? null,
    byAppointment: p.byAppointment,
    startsAt: iso(p.startsAt),
    endsAt: iso(p.endsAt),
    image: images[0] ?? null,
    ...(facts.nextEvent ? { nextEvent: facts.nextEvent } : {}),
    offer: facts.offer,
    sample: p.sample,
  }
}

function dropRef(dropId: string | null) {
  if (!dropId) return null
  const d = drops.find((x) => x.id === dropId)
  return d ? { id: d.id, slug: d.slug, name: d.name } : null
}

export function toPlaceEvent(e: PublicEventRow): PlaceEventDto {
  return {
    id: e.id,
    kind: e.kind as PlaceEventDto["kind"],
    title: e.title,
    description: e.description,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    drop: dropRef(e.dropId),
    promoText: e.promoText,
    image: cleanImage(e.image),
    productIds: e.productIds.filter((id) => productById.get(id)?.brandId === e.brandId),
    sample: e.sample,
  }
}

export function toPlaceDetail(p: PublicPlaceRow, events: PublicEventRow[], now: number): PlaceDetailDto {
  const live = events.filter((e) => eventStillPublic(e, now))
  return {
    ...toPlaceSummary(p, live, now),
    addressLine: p.addressLine,
    hoursNote: p.hoursNote,
    description: p.description,
    images: cleanImages(p.images),
    events: live.map(toPlaceEvent),
    featured: p.featuredProductIds
      .map((id) => productById.get(id))
      .filter((x): x is NonNullable<typeof x> => !!x && x.brandId === p.brandId && x.status === "published")
      .map((x) => ({ id: x.id, slug: x.slug, name: x.name, price: { amount: x.price, currency: x.currency }, image: safePlaceSrc(x.images[0]?.src) })),
  }
}

/* ---------- Studio ---------- */

export function studioStatus(row: { kind: string; visibility: string; moderationStatus: string; endsAt: Date | null }, now: number): StudioPlaceStatus {
  if (row.moderationStatus === "removed") return "removed"
  if (row.moderationStatus === "rejected") return "rejected"
  if (row.endsAt && row.endsAt.getTime() <= now && (row.kind === "popup" || row.kind === "exhibition")) return "ended"
  if (row.visibility === "published") return row.moderationStatus === "pending_review" ? "in_review" : "published"
  return row.visibility === "hidden" ? "hidden" : "draft"
}

function eventStatus(e: EventRow, now: number): StudioPlaceStatus {
  if (e.moderationStatus === "removed") return "removed"
  if (e.moderationStatus === "rejected") return "rejected"
  if (e.endsAt.getTime() <= now) return "ended"
  if (e.visibility === "published") return e.moderationStatus === "pending_review" ? "in_review" : "published"
  return e.visibility === "hidden" ? "hidden" : "draft"
}

export function toStudioEvent(e: EventRow, now: number): StudioEventDto {
  return {
    id: e.id,
    locationId: e.locationId,
    kind: e.kind as StudioEventDto["kind"],
    title: e.title,
    description: e.description,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    dropId: e.dropId,
    productIds: e.productIds,
    promoText: e.promoText,
    image: cleanImage(e.image, "brand"),
    visibility: e.visibility as StudioEventDto["visibility"],
    moderationStatus: e.moderationStatus as StudioEventDto["moderationStatus"],
    moderationReason: e.moderationReason,
    status: eventStatus(e, now),
    locked: e.moderationStatus === "rejected" || e.moderationStatus === "removed",
    sample: e.sample,
    updatedAt: e.updatedAt.toISOString(),
  }
}

export function toStudioLocation(p: PlaceRow, events: EventRow[], now: number): StudioLocationDto {
  const city = p.inGazetteer ? cityBySlug(p.citySlug) : null
  const hood = city && p.neighbourhood ? city.neighbourhoods.find((h) => h.name === p.neighbourhood) : null
  return {
    id: p.id,
    kind: p.kind as StudioLocationDto["kind"],
    name: p.name,
    description: p.description,
    addressLine: p.addressLine,
    neighbourhood: p.neighbourhood,
    neighbourhoodSlug: hood?.slug ?? null,
    city: p.city,
    citySlug: p.citySlug,
    country: p.country,
    inGazetteer: p.inGazetteer,
    lat: p.lat,
    lng: p.lng,
    pinPrecision: p.pinPrecision as StudioLocationDto["pinPrecision"],
    timeZone: p.timeZone,
    hours: p.hours ?? null,
    byAppointment: p.byAppointment,
    hoursNote: p.hoursNote,
    startsAt: iso(p.startsAt),
    endsAt: iso(p.endsAt),
    images: cleanImages(p.images, "brand"),
    featuredProductIds: p.featuredProductIds,
    visibility: p.visibility as StudioLocationDto["visibility"],
    moderationStatus: p.moderationStatus as StudioLocationDto["moderationStatus"],
    moderationReason: p.moderationReason,
    reviewedAt: iso(p.reviewedAt),
    status: studioStatus(p, now),
    locked: p.moderationStatus === "rejected" || p.moderationStatus === "removed",
    canDuplicate: p.moderationStatus !== "removed",
    sample: p.sample,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    publishedAt: iso(p.publishedAt),
    events: events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).map((e) => toStudioEvent(e, now)),
  }
}

/** PlaceBadge (§6.4): the count, a primary place (store or showroom first) and a live or upcoming pop-up within 7 days. */
export function toBadge(places: PublicPlaceRow[], events: PublicEventRow[], now: number): BrandPlaceBadgeDto {
  if (!places.length) return { count: 0 }
  const rank = (k: string) => (k === "store" ? 0 : k === "showroom" ? 1 : 2)
  const primary = [...places].sort((a, b) => rank(a.kind) - rank(b.kind) || (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0) || a.id.localeCompare(b.id))[0]
  const week = now + 7 * 86_400_000
  const dated = places
    .filter((p) => (p.kind === "popup" || p.kind === "exhibition") && p.startsAt && p.endsAt && p.endsAt.getTime() > now && p.startsAt.getTime() <= week)
    .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())[0]
  const ev = events.filter((e) => e.endsAt.getTime() > now && e.startsAt.getTime() <= week).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]
  const evPlace = ev ? places.find((p) => p.id === ev.locationId) : undefined
  const live = dated
    ? { source: "place" as const, placeId: dated.id, title: dated.name, kind: dated.kind as PlaceSummaryDto["kind"], startsAt: dated.startsAt!.toISOString(), endsAt: dated.endsAt!.toISOString(), timeZone: dated.timeZone, sample: dated.sample }
    : ev && evPlace
      ? { source: "event" as const, placeId: evPlace.id, title: ev.title, kind: evPlace.kind as PlaceSummaryDto["kind"], startsAt: ev.startsAt.toISOString(), endsAt: ev.endsAt.toISOString(), timeZone: evPlace.timeZone, sample: ev.sample || evPlace.sample }
      : undefined
  return {
    count: places.length,
    primary: { id: primary.id, kind: primary.kind as PlaceSummaryDto["kind"], neighbourhood: primary.neighbourhood, city: primary.city, sample: primary.sample, timeZone: primary.timeZone },
    ...(live ? { live } : {}),
  }
}
