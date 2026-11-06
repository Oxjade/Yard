import { z } from "zod"
import { LOCATION_EVENT_KINDS, LOCATION_KINDS, PIN_PRECISIONS, PLACE_MODERATION, PUBLISH_VISIBILITIES } from "./enums"

/** Around contracts (F1 draft; cluster A owns this file in wave 2, §6.4). */
export const tileKey = z.string().regex(/^-?\d{1,3}_-?\d{1,3}$/)
export const placesQuery = z.object({
  tiles: z.string().max(200).optional(),
  scope: z.literal("world").optional(),
  kind: z.enum(LOCATION_KINDS).optional(),
  category: z.string().max(40).optional(),
})

const hoursDay = z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)])).nullable()
export const placeHours = z.object({ mon: hoursDay, tue: hoursDay, wed: hoursDay, thu: hoursDay, fri: hoursDay, sat: hoursDay, sun: hoursDay })

export const placeSummaryDto = z.object({
  id: z.string(),
  brand: z.object({ id: z.string(), handle: z.string(), name: z.string(), verified: z.boolean() }),
  brandCategory: z.string(),
  kind: z.enum(LOCATION_KINDS),
  name: z.string(),
  neighbourhood: z.string().nullable(),
  city: z.string(),
  citySlug: z.string(),
  country: z.string(),
  lat: z.number(),
  lng: z.number(),
  pinPrecision: z.enum(PIN_PRECISIONS),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  image: z.object({ src: z.string(), alt: z.string(), width: z.number(), height: z.number() }).nullable(),
  nextEvent: z.object({ title: z.string(), startsAt: z.string(), kind: z.enum(LOCATION_EVENT_KINDS), hasDrop: z.boolean(), hasPromo: z.boolean() }).optional(),
  sample: z.boolean(),
})
export type PlaceSummaryDto = z.infer<typeof placeSummaryDto>

export const locationWriteBody = z
  .object({
    kind: z.enum(LOCATION_KINDS),
    name: z.string().min(1).max(80),
    addressLine: z.string().min(1).max(140),
    neighbourhood: z.string().max(60).nullable().optional(),
    city: z.string().min(1).max(60),
    country: z.string().length(2),
    inGazetteer: z.boolean().default(true),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    pinPrecision: z.enum(PIN_PRECISIONS).default("area"),
    hours: placeHours.nullable().optional(),
    byAppointment: z.boolean().default(false),
    hoursNote: z.string().max(120).nullable().optional(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    /** Ids and alt text only: the server builds every src (§2.6). */
    images: z.array(z.object({ mediaId: z.string(), alt: z.string().min(1).max(200) }).strict()).max(6).default([]),
    featuredProductIds: z.array(z.string()).max(8).default([]),
    description: z.string().max(600).nullable().optional(),
    visibility: z.enum(PUBLISH_VISIBILITIES).default("draft"),
  })
  .strict()

export const studioLocationDto = placeSummaryDto.extend({
  addressLine: z.string(),
  visibility: z.enum(PUBLISH_VISIBILITIES),
  moderationStatus: z.enum(PLACE_MODERATION),
  moderationReason: z.string().nullable(),
  hours: placeHours.nullable(),
  byAppointment: z.boolean(),
  hoursNote: z.string().nullable(),
  images: z.array(z.object({ mediaId: z.string().optional(), src: z.string(), alt: z.string(), width: z.number(), height: z.number() })),
  featuredProductIds: z.array(z.string()),
  description: z.string().nullable(),
  updatedAt: z.string(),
})

export const locationEventBody = z
  .object({
    kind: z.enum(LOCATION_EVENT_KINDS),
    title: z.string().min(1).max(80),
    description: z.string().max(600).nullable().optional(),
    startsAt: z.string(),
    endsAt: z.string(),
    dropId: z.string().nullable().optional(),
    productIds: z.array(z.string()).max(8).default([]),
    promoText: z.string().max(120).nullable().optional(),
    image: z.object({ mediaId: z.string(), alt: z.string().min(1).max(200) }).strict().nullable().optional(),
    visibility: z.enum(PUBLISH_VISIBILITIES).default("draft"),
  })
  .strict()

export const brandPlaceBadgeDto = z.object({
  count: z.number(),
  primary: z.object({ id: z.string(), kind: z.enum(LOCATION_KINDS), neighbourhood: z.string().nullable(), city: z.string(), sample: z.boolean() }).optional(),
  live: z.object({ title: z.string(), startsAt: z.string(), endsAt: z.string() }).optional(),
})
