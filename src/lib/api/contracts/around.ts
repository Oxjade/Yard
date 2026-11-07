import { z } from "zod"
import { LOCATION_EVENT_KINDS, LOCATION_KINDS, PIN_PRECISIONS, PLACE_MODERATION, PUBLISH_VISIBILITIES } from "./enums"

/**
 * YARD Around contracts (§6.4, §5.6; cluster A). Public reads only ever carry what
 * publicPlaces() returns. Every image src is `/api/media/<id>` or a seed `/media/…` path, and
 * renderers refuse anything else (safePlaceSrc). Write bodies are strict: images travel as media
 * ids plus alt text only, and the server builds every src (§2.6).
 */

export const MARKET_COUNTRIES = ["NG", "GH", "KE", "ZA", "GB", "FR", "DE", "US", "MX", "JP", "KR"] as const

export const tileKey = z.string().regex(/^-?\d{1,3}_-?\d{1,3}$/, { error: "Use tiles like 6_3." })

/** `?tiles=6_3,6_4` (at most 12 one-degree cells) or `?scope=world`; never both. */
export const placesQuery = z
  .object({
    tiles: z.string().max(200).optional(),
    scope: z.literal("world").optional(),
    kind: z.enum(LOCATION_KINDS).optional(),
    category: z.string().max(40).optional(),
  })
  .strict()

export const onlineBrandsQuery = z.object({ city: z.string().regex(/^[a-z0-9-]{1,60}$/, { error: "Use a city slug like berlin." }) }).strict()

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, { error: "Use a time like 10:00." })
const hoursDay = z.array(z.tuple([hhmm, hhmm])).max(2, { error: "Up to two ranges a day." }).nullable()
export const placeHours = z.object({ mon: hoursDay, tue: hoursDay, wed: hoursDay, thu: hoursDay, fri: hoursDay, sat: hoursDay, sun: hoursDay }).strict()
export type PlaceHoursDto = z.infer<typeof placeHours>

export const placeImageDto = z.object({ mediaId: z.string().optional(), src: z.string(), alt: z.string(), width: z.number(), height: z.number() })
export type PlaceImageDto = z.infer<typeof placeImageDto>

export const placeBrandDto = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  verified: z.boolean(),
  mark: z.object({ text: z.string(), style: z.enum(["condensed", "expanded", "grotesk"]) }),
})

export const nextEventDto = z.object({ id: z.string(), title: z.string(), startsAt: z.string(), endsAt: z.string(), kind: z.enum(LOCATION_EVENT_KINDS), hasDrop: z.boolean(), hasPromo: z.boolean() })

export const placeSummaryDto = z.object({
  id: z.string(),
  brand: placeBrandDto,
  /** The brand's main category ("Streetwear"). */
  brandCategory: z.string(),
  /** Every category slug of the brand, for the Category filter. */
  brandCategories: z.array(z.string()),
  kind: z.enum(LOCATION_KINDS),
  name: z.string(),
  neighbourhood: z.string().nullable(),
  city: z.string(),
  citySlug: z.string(),
  country: z.string(),
  inGazetteer: z.boolean(),
  lat: z.number(),
  lng: z.number(),
  pinPrecision: z.enum(PIN_PRECISIONS),
  timeZone: z.string(),
  hours: placeHours.nullable(),
  byAppointment: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  image: placeImageDto.nullable(),
  /** The next live or upcoming public event, when there is one. */
  nextEvent: nextEventDto.optional(),
  /** A live or upcoming public event with a drop or promo text (the Drops & offers filter). */
  offer: z.boolean(),
  sample: z.boolean(),
})
export type PlaceSummaryDto = z.infer<typeof placeSummaryDto>
export const placesResult = z.object({ places: z.array(placeSummaryDto), scope: z.enum(["world", "tiles"]) })
export type PlacesResult = z.infer<typeof placesResult>

export const placeEventDto = z.object({
  id: z.string(),
  kind: z.enum(LOCATION_EVENT_KINDS),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  drop: z.object({ id: z.string(), slug: z.string(), name: z.string() }).nullable(),
  promoText: z.string().nullable(),
  image: placeImageDto.nullable(),
  productIds: z.array(z.string()),
  sample: z.boolean(),
})
export type PlaceEventDto = z.infer<typeof placeEventDto>

export const featuredProductDto = z.object({ id: z.string(), slug: z.string(), name: z.string(), price: z.object({ amount: z.number(), currency: z.string() }), image: z.string().nullable() })

export const placeDetailDto = placeSummaryDto.extend({
  addressLine: z.string(),
  hoursNote: z.string().nullable(),
  description: z.string().nullable(),
  images: z.array(placeImageDto),
  events: z.array(placeEventDto),
  featured: z.array(featuredProductDto),
})
export type PlaceDetailDto = z.infer<typeof placeDetailDto>
export const placeDetailResult = z.object({ place: placeDetailDto })

export const onlineBrandsResult = z.object({ city: z.string(), brands: z.array(placeBrandDto.extend({ city: z.string(), country: z.string() })) })
export type OnlineBrandsResult = z.infer<typeof onlineBrandsResult>

/** For N's PlaceBadge (§6.4): "Showroom in Ikoyi", or "Pop-up this Saturday". */
export const brandPlaceBadgeDto = z.object({
  count: z.number(),
  primary: z.object({ id: z.string(), kind: z.enum(LOCATION_KINDS), neighbourhood: z.string().nullable(), city: z.string(), sample: z.boolean(), timeZone: z.string() }).optional(),
  /** A pop-up or exhibition (`source: 'place'`) or an event at a place (`'event'`) that's live or starts within 7 days. */
  live: z.object({ source: z.enum(["place", "event"]), placeId: z.string(), title: z.string(), kind: z.enum(LOCATION_KINDS), startsAt: z.string(), endsAt: z.string(), timeZone: z.string(), sample: z.boolean() }).optional(),
})
export type BrandPlaceBadgeDto = z.infer<typeof brandPlaceBadgeDto>

/* ---------- Studio ---------- */

const imageRef = z.object({ mediaId: z.string().min(1).max(80), alt: z.string().trim().min(1, { error: "Describe the photo for people who can't see it." }).max(200) }).strict()
/** Instants a place or event can carry: 2000–2100, so nothing out of the database's range ever reaches it. */
const isoInstant = z
  .string()
  .datetime({ offset: true, error: "Use a full date and time." })
  .refine((s) => {
    const y = new Date(s).getUTCFullYear()
    return y >= 2000 && y <= 2100
  }, { error: "Choose a date between 2000 and 2100." })

/**
 * Date rules for pop-ups, exhibitions and events (§6.4), shared by the server and the Studio
 * forms so both say the same sentence. A start more than a year back, an end more than two years
 * ahead, or a run longer than 180 days isn't a pop-up: those come back as field errors.
 */
export const DATE_RULES = { maxPastDays: 365, maxFutureDays: 730, maxSpanDays: 180 } as const
const DAY_MS = 86_400_000

export function dateRangeProblems(startsAt: number, endsAt: number, now: number, word: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return out
  if (startsAt < now - DATE_RULES.maxPastDays * DAY_MS) out.startsAt = "Choose a start within the last year."
  if (endsAt > now + DATE_RULES.maxFutureDays * DAY_MS) out.endsAt = "Choose an end within the next two years."
  else if (endsAt > startsAt && endsAt - startsAt > DATE_RULES.maxSpanDays * DAY_MS) out.endsAt = `${word} can run for up to 180 days.`
  return out
}

/**
 * Create a place. City is either a gazetteer city (`inGazetteer: true`, `citySlug`, an optional
 * gazetteer `neighbourhoodSlug` or a typed `neighbourhoodName`) or an "Other city"
 * (`inGazetteer: false`, `cityName`, `country`, optional `neighbourhoodName`). Coordinates are
 * checked against the city on the server.
 */
export const locationWriteBody = z
  .object({
    kind: z.enum(LOCATION_KINDS),
    name: z.string().trim().min(1, { error: "Name this place." }).max(80),
    description: z.string().trim().max(600).nullable().optional(),
    inGazetteer: z.boolean().default(true),
    citySlug: z.string().max(60).nullable().optional(),
    neighbourhoodSlug: z.string().max(60).nullable().optional(),
    neighbourhoodName: z.string().trim().max(60).nullable().optional(),
    cityName: z.string().trim().max(60).nullable().optional(),
    country: z.enum(MARKET_COUNTRIES).nullable().optional(),
    addressLine: z.string().trim().min(1, { error: "Add the street address." }).max(140),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    pinPrecision: z.enum(PIN_PRECISIONS).default("area"),
    hours: placeHours.nullable().optional(),
    byAppointment: z.boolean().default(false),
    hoursNote: z.string().trim().max(120).nullable().optional(),
    startsAt: isoInstant.nullable().optional(),
    endsAt: isoInstant.nullable().optional(),
    images: z.array(imageRef).max(6, { error: "Up to 6 photos." }).default([]),
    featuredProductIds: z.array(z.string().max(80)).max(8, { error: "Up to 8 pieces." }).default([]),
    visibility: z.enum(PUBLISH_VISIBILITIES).default("draft"),
  })
  .strict()
export type LocationWriteBody = z.input<typeof locationWriteBody>

/** Edit: any subset of the create fields (`{ visibility }` alone publishes or hides). */
export const locationPatchBody = z
  .object({
    kind: z.enum(LOCATION_KINDS).optional(),
    name: z.string().trim().min(1, { error: "Name this place." }).max(80).optional(),
    description: z.string().trim().max(600).nullable().optional(),
    inGazetteer: z.boolean().optional(),
    citySlug: z.string().max(60).nullable().optional(),
    neighbourhoodSlug: z.string().max(60).nullable().optional(),
    neighbourhoodName: z.string().trim().max(60).nullable().optional(),
    cityName: z.string().trim().max(60).nullable().optional(),
    country: z.enum(MARKET_COUNTRIES).nullable().optional(),
    addressLine: z.string().trim().min(1, { error: "Add the street address." }).max(140).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    pinPrecision: z.enum(PIN_PRECISIONS).optional(),
    hours: placeHours.nullable().optional(),
    byAppointment: z.boolean().optional(),
    hoursNote: z.string().trim().max(120).nullable().optional(),
    startsAt: isoInstant.nullable().optional(),
    endsAt: isoInstant.nullable().optional(),
    images: z.array(imageRef).max(6, { error: "Up to 6 photos." }).optional(),
    featuredProductIds: z.array(z.string().max(80)).max(8, { error: "Up to 8 pieces." }).optional(),
    visibility: z.enum(PUBLISH_VISIBILITIES).optional(),
  })
  .strict()
export type LocationPatchBody = z.input<typeof locationPatchBody>

export const duplicateBody = z.object({ startsAt: isoInstant.optional(), endsAt: isoInstant.optional() }).strict()

export const locationEventBody = z
  .object({
    kind: z.enum(LOCATION_EVENT_KINDS),
    title: z.string().trim().min(1, { error: "Give the event a title." }).max(80),
    description: z.string().trim().max(600).nullable().optional(),
    startsAt: isoInstant,
    endsAt: isoInstant,
    dropId: z.string().max(80).nullable().optional(),
    productIds: z.array(z.string().max(80)).max(8, { error: "Up to 8 pieces." }).default([]),
    promoText: z.string().trim().max(120).nullable().optional(),
    image: imageRef.nullable().optional(),
    visibility: z.enum(PUBLISH_VISIBILITIES).default("draft"),
  })
  .strict()
export type LocationEventBody = z.input<typeof locationEventBody>
export const locationEventPatchBody = locationEventBody.partial().strict()
export type LocationEventPatchBody = z.input<typeof locationEventPatchBody>

/**
 * What Studio shows as the status (§6.4): Published, Draft, Hidden, In review, Ended (a pop-up or
 * exhibition past its end), Rejected or Removed by Yard (locked: delete only, rejected can be
 * duplicated).
 */
export const STUDIO_PLACE_STATUSES = ["published", "draft", "hidden", "in_review", "ended", "rejected", "removed"] as const
export type StudioPlaceStatus = (typeof STUDIO_PLACE_STATUSES)[number]

export const studioEventDto = z.object({
  id: z.string(),
  locationId: z.string(),
  kind: z.enum(LOCATION_EVENT_KINDS),
  title: z.string(),
  description: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  dropId: z.string().nullable(),
  productIds: z.array(z.string()),
  promoText: z.string().nullable(),
  image: placeImageDto.nullable(),
  visibility: z.enum(PUBLISH_VISIBILITIES),
  moderationStatus: z.enum(PLACE_MODERATION),
  moderationReason: z.string().nullable(),
  status: z.enum(STUDIO_PLACE_STATUSES),
  locked: z.boolean(),
  sample: z.boolean(),
  updatedAt: z.string(),
})
export type StudioEventDto = z.infer<typeof studioEventDto>

export const studioLocationDto = z.object({
  id: z.string(),
  kind: z.enum(LOCATION_KINDS),
  name: z.string(),
  description: z.string().nullable(),
  addressLine: z.string(),
  neighbourhood: z.string().nullable(),
  /** The gazetteer neighbourhood slug when the neighbourhood is one of the gazetteer's. */
  neighbourhoodSlug: z.string().nullable(),
  city: z.string(),
  citySlug: z.string(),
  country: z.string(),
  inGazetteer: z.boolean(),
  lat: z.number(),
  lng: z.number(),
  pinPrecision: z.enum(PIN_PRECISIONS),
  timeZone: z.string(),
  hours: placeHours.nullable(),
  byAppointment: z.boolean(),
  hoursNote: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  images: z.array(placeImageDto),
  featuredProductIds: z.array(z.string()),
  visibility: z.enum(PUBLISH_VISIBILITIES),
  moderationStatus: z.enum(PLACE_MODERATION),
  moderationReason: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  status: z.enum(STUDIO_PLACE_STATUSES),
  locked: z.boolean(),
  canDuplicate: z.boolean(),
  sample: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
  events: z.array(studioEventDto),
})
export type StudioLocationDto = z.infer<typeof studioLocationDto>

/** What a write did, so Studio can say it plainly (§6.4 Review rules). */
export const WRITE_OUTCOMES = ["published", "submitted", "resubmitted", "saved", "hidden", "draft"] as const
export type WriteOutcome = (typeof WRITE_OUTCOMES)[number]
export const studioLocationsResult = z.object({ locations: z.array(studioLocationDto), brand: z.object({ id: z.string(), name: z.string(), verified: z.boolean(), reviewStatus: z.string(), city: z.string(), citySlug: z.string(), country: z.string(), timeZone: z.string() }) })
export type StudioLocationsResult = z.infer<typeof studioLocationsResult>
export const studioLocationResult = z.object({ location: studioLocationDto, outcome: z.enum(WRITE_OUTCOMES).optional() })
export type StudioLocationResult = z.infer<typeof studioLocationResult>
export const studioEventResult = z.object({ event: studioEventDto, location: studioLocationDto, outcome: z.enum(WRITE_OUTCOMES).optional() })
export type StudioEventResult = z.infer<typeof studioEventResult>

/** The sentence a write outcome reads as (Studio toasts and inline notes). */
export const outcomeCopy: Record<WriteOutcome, string> = {
  published: "Published — it shows on Around within a minute.",
  submitted: "Submitted for review — Yard checks new places from brands that aren't verified yet.",
  resubmitted: "Submitted for review — Yard checked this place before, so changes go back to review.",
  saved: "Saved.",
  hidden: "Hidden — it no longer shows on Around.",
  draft: "Saved as a draft. Only your team can see it.",
}
