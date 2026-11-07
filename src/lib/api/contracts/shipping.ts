import { z } from "zod"
import { COMPLAINT_KINDS, COMPLAINT_STATUSES, ESTIMATE_BASES, SHIPMENT_SOURCES, SHIPMENT_STATUSES, SHIPPING_SERVICES, ZONE_KINDS } from "./enums"

/**
 * Shipping and delivery contracts (cluster D, §6.5). Every date is a calendar date
 * ('YYYY-MM-DD') and every estimate is an estimate: `guaranteed` is always false in this build
 * (only a future carrier that guarantees dates could return true) and `isEstimate` always true.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use a date like 2026-11-06." })
const money = z.object({ amount: z.number().int(), currency: z.string().length(3) })
const country = z.string().regex(/^[A-Z]{2}$/, { error: "Use a two-letter country code." })
const currency = z.string().regex(/^[A-Z]{3}$/, { error: "Use a three-letter currency code." })

/**
 * Control characters (NUL above all: Postgres refuses it in text, which would surface as a 500 and
 * put the statement in the server log). Tabs and line breaks stay allowed for multi-line fields.
 */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const LINE_BREAK = /[\r\n\t]/
/** Every free-text string this contract accepts goes through one of these two (ids through idText). */
const safeText = () => z.string().refine((s) => !CONTROL.test(s), { error: "Remove the hidden characters." })
const safeLine = () => z.string().refine((s) => !CONTROL.test(s) && !LINE_BREAK.test(s), { error: "Remove the hidden characters." })
/** An id-like value (product, variant, brand, row ids): letters, digits, `_` and `-` only. */
const idText = (max = 80) => z.string().min(1).max(max).regex(/^[\w-]+$/, { error: "That id isn't valid." })

export const holidayRefDto = z.object({ date, name: z.string(), country: z.string() })
export type HolidayRefDto = z.infer<typeof holidayRefDto>

export const estimateDto = z.object({
  basis: z.enum([...ESTIMATE_BASES, "quote"]),
  dispatchFrom: date.optional(),
  shipBy: date.optional(),
  arrivalFrom: date.optional(),
  arrivalTo: date.optional(),
  deliveredOn: date.optional(),
  late: z.boolean(),
  holidaysCrossed: z.array(holidayRefDto),
  guaranteed: z.literal(false),
  isEstimate: z.literal(true),
})
export type EstimateDto = z.infer<typeof estimateDto>

export const quoteOptionDto = z.object({
  methodId: z.string(),
  service: z.enum(SHIPPING_SERVICES),
  label: z.string(),
  available: z.boolean(),
  /** Why it isn't available: "Doesn't ship to Japan". */
  reason: z.string().optional(),
  /** In the shopper's currency. */
  price: money,
  /** In the brand's currency (what the brand set). */
  priceBrand: money.optional(),
  free: z.boolean(),
  /** The subtotal (shopper currency) above which this option ships free, from the brand's tiers. */
  freeOver: money.optional(),
  /** Business days in transit. */
  transit: z.tuple([z.number(), z.number()]),
  providerId: z.string(),
  guaranteed: z.literal(false),
  estimate: estimateDto.optional(),
  /** Pickup only: where the parcel is collected. */
  pickup: z.object({ name: z.string(), area: z.string() }).optional(),
})
export type QuoteOptionDto = z.infer<typeof quoteOptionDto>

/** Who ships it and from where (no addresses: the origin city only). */
export const shippingBrandDto = z.object({
  id: z.string(),
  name: z.string(),
  originCity: z.string(),
  originCountry: z.string(),
  timeZone: z.string(),
  cutoffLocal: z.string(),
  /** bit0 = Monday … bit6 = Sunday. */
  workdays: z.number().int(),
})
export type ShippingBrandDto = z.infer<typeof shippingBrandDto>

/* ---------- GET /api/shipping/estimate (milestone 1) ---------- */

export const estimateQuery = z.object({
  product: idText(),
  to: country,
  city: safeLine().trim().max(60).optional(),
  qty: z.coerce.number().int().min(1).max(20).optional(),
  cur: currency.optional(),
  /** An unreleased drop's release (ISO), as this browser's drop clock reads it. Ignored for pieces outside a drop. */
  release: z.string().datetime({ offset: true }).optional(),
})
export type EstimateQuery = z.infer<typeof estimateQuery>

export const estimateResponse = z.object({
  brand: shippingBrandDto,
  /** Business days to pack and hand over: the brand's handling time, or the piece's own when longer. */
  handling: z.tuple([z.number(), z.number()]),
  destination: z.object({ country: z.string(), city: z.string().nullable() }),
  options: z.array(quoteOptionDto),
  /** Every option unavailable (no zone covers the destination, or it's switched off). */
  unavailable: z.boolean(),
  reason: z.string().optional(),
  /**
   * Today's order cutoff as an instant, when today is a working day at the origin and the cutoff
   * hasn't passed at `computedAt`: before it, an order counts from today. Null otherwise.
   */
  cutoffAt: z.string().nullable(),
  /** The holiday countries the estimate skips (origin and destination), for the footnote. */
  calendarCountries: z.array(z.string()),
  providerKind: z.enum(["manual", "carrier"]),
  computedAt: z.string(),
})
export type EstimateResponse = z.infer<typeof estimateResponse>

/* ---------- POST /api/shipping/quote ---------- */

export const quoteLine = z.object({ productId: idText(), variantId: idText(), qty: z.number().int().min(1).max(20) }).strict()

export const quoteBody = z
  .object({
    to: country,
    city: safeLine().trim().max(60).optional(),
    currency,
    groups: z.array(z.object({ brandId: idText(), lines: z.array(quoteLine).min(1).max(50) }).strict()).min(1).max(20),
  })
  .strict()
export type QuoteBody = z.infer<typeof quoteBody>

export const quoteGroupDto = z.object({
  brandId: z.string(),
  brand: shippingBrandDto,
  handling: z.tuple([z.number(), z.number()]),
  subtotal: money,
  options: z.array(quoteOptionDto),
  unavailable: z.boolean(),
  reason: z.string().optional(),
  /** Signed over brand, destination, lines, subtotal and the option prices; expires in 30 minutes. */
  quoteToken: z.string(),
})
export type QuoteGroupDto = z.infer<typeof quoteGroupDto>

export const quoteResponse = z.object({ groups: z.array(quoteGroupDto), computedAt: z.string(), expiresAt: z.string() })
export type QuoteResponse = z.infer<typeof quoteResponse>

/* ---------- GET /api/shipping/holidays ---------- */

export const holidaysQuery = z.object({ country, from: date.optional(), to: date.optional() })
export const holidayDto = holidayRefDto.extend({ kind: z.enum(["public", "carrier"]), estimated: z.boolean() })
export type HolidayDto = z.infer<typeof holidayDto>

/* ---------- POST /api/orders/register ---------- */

/** No ids, references, brand ids or customer ids: the server derives and mints them all (SEC-5). */
export const registerOrderBody = z
  .object({
    idempotencyKey: z.string().min(8).max(80).regex(/^[\w-]+$/, { error: "That key isn't valid." }),
    currency,
    shipTo: z.object({ country, city: safeLine().trim().max(60).optional() }).strict(),
    groups: z.array(z.object({ lines: z.array(quoteLine).min(1).max(50), service: z.enum(SHIPPING_SERVICES), quoteToken: z.string().min(1).max(4000).regex(/^[\w.-]+$/, { error: "That quote isn't valid." }) }).strict()).min(1).max(20),
  })
  .strict()
export type RegisterOrderBody = z.infer<typeof registerOrderBody>

/** The estimate as an order keeps it (matches DeliverySnapshot in lib/data/types). */
export const deliverySnapshotDto = estimateDto.omit({ holidaysCrossed: true, isEstimate: true }).extend({
  service: z.enum(SHIPPING_SERVICES).optional(),
  source: z.enum(["server", "browser"]),
  computedAt: z.string(),
})
export type DeliverySnapshotDto = z.infer<typeof deliverySnapshotDto>

export const registeredOrderDto = z.object({
  id: z.string(),
  reference: z.string(),
  brandId: z.string(),
  service: z.enum(SHIPPING_SERVICES),
  subtotal: z.number().int(),
  shipping: z.number().int(),
  total: z.number().int(),
  delivery: deliverySnapshotDto,
})
export const registerResponse = z.object({ groupId: z.string(), reference: z.string(), customerId: z.string(), placedAt: z.string(), currency: z.string(), orders: z.array(registeredOrderDto), duplicate: z.boolean() })
export type RegisterResponse = z.infer<typeof registerResponse>

/* ---------- Delivery: shopper and Studio ---------- */

export const shipmentEventDto = z.object({
  id: z.string(),
  status: z.enum(SHIPMENT_STATUSES),
  occurredAt: z.string(),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  locationText: z.string().nullable(),
  note: z.string().nullable(),
  source: z.enum(SHIPMENT_SOURCES),
  /**
   * The brand's note scored like an Inbox message (§5.2). Held: Yard checks it first, so the
   * shopper never receives the text (Studio sees that it's held). Notice: delivered with the
   * "Keep payments on Yard" line above it.
   */
  noteHeld: z.boolean().optional(),
  noteNotice: z.boolean().optional(),
})
export type ShipmentEventDto = z.infer<typeof shipmentEventDto>

export const complaintKindLabels: Record<(typeof COMPLAINT_KINDS)[number], string> = {
  late: "It's late",
  not_received: "Marked delivered, but it hasn't arrived",
  damaged: "It arrived damaged",
  wrong_item: "Wrong item",
  wrong_address: "Going to the wrong address",
  other: "Something else",
}

export const complaintStatusLabels: Record<(typeof COMPLAINT_STATUSES)[number], string> = {
  open: "Sent to the brand",
  waiting_brand: "Waiting for the brand",
  brand_responded: "The brand replied",
  resolved: "Resolved",
  escalated: "With Yard's support team",
}

export const complaintDto = z.object({
  id: z.string(),
  kind: z.enum(COMPLAINT_KINDS),
  details: z.string(),
  status: z.enum(COMPLAINT_STATUSES),
  brandResponse: z.string().nullable(),
  /** As noteHeld / noteNotice on events: the brand's reply was held for Yard's review, or carries the payments notice. */
  responseHeld: z.boolean().optional(),
  responseNotice: z.boolean().optional(),
  resolution: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
})
export type ComplaintDto = z.infer<typeof complaintDto>

export const currentEstimateDto = estimateDto.extend({ providerId: z.string(), reason: z.string().nullable(), computedAt: z.string() })
export type CurrentEstimateDto = z.infer<typeof currentEstimateDto>

export const deliveryDto = z.object({
  orderId: z.string(),
  reference: z.string(),
  brand: z.object({ id: z.string(), name: z.string() }),
  service: z.enum(SHIPPING_SERVICES),
  shipTo: z.object({ country: z.string(), city: z.string().nullable() }),
  placedAt: z.string(),
  sample: z.boolean(),
  estimate: currentEstimateDto,
  /** The first estimate the order had, so a change can be shown against it. */
  placedEstimate: currentEstimateDto.nullable(),
  /** The day it shipped (origin calendar), when a shipped event exists. */
  shippedOn: date.nullable(),
  events: z.array(shipmentEventDto),
  complaint: complaintDto.nullable(),
})
export type DeliveryDto = z.infer<typeof deliveryDto>

export const shipmentEventBody = z
  .object({
    status: z.enum(SHIPMENT_STATUSES),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    carrier: safeLine().trim().max(60).optional(),
    trackingNumber: safeLine().trim().max(80).optional(),
    note: safeText().trim().max(280).optional(),
  })
  .strict()
export type ShipmentEventBody = z.infer<typeof shipmentEventBody>

export const complaintBody = z
  .object({
    kind: z.enum(COMPLAINT_KINDS),
    details: safeText().trim().max(1000, { error: "Keep it to 1,000 characters." }),
  })
  .strict()
export type ComplaintBody = z.infer<typeof complaintBody>

export const complaintResponseBody = z.object({ message: safeText().trim().min(1, { error: "Write a reply first." }).max(1000, { error: "Keep it to 1,000 characters." }) }).strict()

/* ---------- Studio Shipping & fulfilment ---------- */

const rowId = safeLine().max(80).optional()

export const rateInput = z.object({ id: rowId, minSubtotalMinor: z.number().int().min(0).max(2_000_000_000), amountMinor: z.number().int().min(0).max(2_000_000_000) }).strict()
export const methodInput = z
  .object({
    /** Ignored: the server replaces every row with a fresh id (§2.6). */
    id: rowId,
    service: z.enum(SHIPPING_SERVICES),
    label: safeLine().trim().min(1, { error: "Give it a name." }).max(40),
    enabled: z.boolean(),
    transitMin: z.number().int().min(0).max(60),
    transitMax: z.number().int().min(0).max(60),
    carrierLabel: safeLine().trim().max(40).nullable().optional(),
    rates: z.array(rateInput).min(1, { error: "Add a price." }).max(6),
  })
  .strict()
export const zoneInput = z
  .object({
    id: rowId,
    name: safeLine().trim().min(1, { error: "Name the zone." }).max(40),
    kind: z.enum(ZONE_KINDS),
    countries: z.array(z.string().regex(/^([A-Z]{2}|\*)$/)).min(1, { error: "Choose at least one country." }).max(60),
    enabled: z.boolean(),
    methods: z.array(methodInput).max(3),
  })
  .strict()

export const shippingProfileBody = z
  .object({
    originCountry: country,
    originCity: safeLine().trim().min(1, { error: "Enter the city you ship from." }).max(60),
    handlingMin: z.number().int().min(0).max(30),
    handlingMax: z.number().int().min(0).max(30),
    cutoffLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Use a time like 14:00." }),
    workdays: z.number().int().min(1, { error: "Choose at least one day." }).max(127),
    localPickup: z.boolean(),
    pickupLocationId: idText().nullable(),
    zones: z.array(zoneInput).min(1).max(12),
    closures: z.array(z.object({ id: rowId, dateFrom: date, dateTo: date, reason: safeLine().trim().max(80).nullable().optional() }).strict()).max(20),
  })
  .strict()
export type ShippingProfileBody = z.infer<typeof shippingProfileBody>

export const rateDto = z.object({ id: z.string(), minSubtotalMinor: z.number(), amountMinor: z.number() })
export const methodDto = z.object({ id: z.string(), service: z.enum(SHIPPING_SERVICES), label: z.string(), enabled: z.boolean(), transitMin: z.number(), transitMax: z.number(), carrierLabel: z.string().nullable(), rates: z.array(rateDto) })
export const zoneDto = z.object({ id: z.string(), name: z.string(), kind: z.enum(ZONE_KINDS), countries: z.array(z.string()), enabled: z.boolean(), methods: z.array(methodDto) })
export type ZoneDto = z.infer<typeof zoneDto>
export type MethodDto = z.infer<typeof methodDto>

export const pickupOptionDto = z.object({ id: z.string(), name: z.string(), kind: z.string(), area: z.string(), citySlug: z.string() })

export const studioShippingDto = z.object({
  brand: z.object({ id: z.string(), name: z.string(), currency: z.string(), country: z.string() }),
  profile: z.object({
    originCountry: z.string(),
    originCity: z.string(),
    timeZone: z.string(),
    handlingMin: z.number(),
    handlingMax: z.number(),
    cutoffLocal: z.string(),
    workdays: z.number(),
    localPickup: z.boolean(),
    pickupLocationId: z.string().nullable(),
    providerId: z.string(),
    currency: z.string(),
    updatedAt: z.string(),
    /** Null until a brand member saves (the seed values stand until then). */
    updatedBy: z.string().nullable(),
  }),
  zones: z.array(zoneDto),
  closures: z.array(z.object({ id: z.string(), dateFrom: date, dateTo: date, reason: z.string().nullable() })),
  /** The origin country's holidays from today on (read-only here; Yard's team edits them). */
  holidays: z.array(holidayDto),
  /** Destination holidays the preview may need, keyed by country. */
  destinationHolidays: z.record(z.string(), z.array(holidayRefDto)),
  /** This brand's published, approved stores and showrooms. */
  pickupOptions: z.array(pickupOptionDto),
  provider: z.object({ id: z.string(), label: z.string(), kind: z.enum(["manual", "carrier"]) }),
  carriers: z.array(z.object({ id: z.string(), label: z.string(), configured: z.boolean() })),
})
export type StudioShippingDto = z.infer<typeof studioShippingDto>

/** Payloads this feature publishes (imported by contracts/realtime.ts). */
export const shippingRealtimeEvents = {
  "order.estimate": z.object({
    orderId: z.string(),
    estimate: estimateDto,
    /** When the estimate was stored, and the ship date (shipment events only). */
    computedAt: z.string().optional(),
    shippedOn: date.nullable().optional(),
  }),
}
