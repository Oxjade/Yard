import { z } from "zod"
import { COMPLAINT_KINDS, ESTIMATE_BASES, SHIPMENT_STATUSES, SHIPPING_SERVICES, ZONE_KINDS } from "./enums"

/** Shipping and delivery contracts (F1 draft; cluster D owns this file in wave 2, §6.5). Estimates are never guaranteed. */
export const estimateDto = z.object({
  basis: z.enum([...ESTIMATE_BASES, "quote"]),
  dispatchFrom: z.string().optional(),
  shipBy: z.string().optional(),
  arrivalFrom: z.string().optional(),
  arrivalTo: z.string().optional(),
  deliveredOn: z.string().optional(),
  late: z.boolean(),
  holidaysCrossed: z.array(z.object({ date: z.string(), name: z.string(), country: z.string() })),
  guaranteed: z.literal(false),
  isEstimate: z.literal(true),
})
export type EstimateDto = z.infer<typeof estimateDto>

const money = z.object({ amount: z.number().int(), currency: z.string() })

export const quoteOptionDto = z.object({
  methodId: z.string(),
  service: z.enum(SHIPPING_SERVICES),
  label: z.string(),
  available: z.boolean(),
  reason: z.string().optional(),
  price: money,
  priceBrand: money.optional(),
  free: z.boolean(),
  freeOver: money.optional(),
  transit: z.tuple([z.number(), z.number()]),
  providerId: z.string(),
  guaranteed: z.literal(false),
  estimate: estimateDto.optional(),
})
export type QuoteOptionDto = z.infer<typeof quoteOptionDto>

export const estimateQuery = z.object({ product: z.string(), to: z.string().length(2), city: z.string().max(60).optional(), qty: z.coerce.number().int().min(1).max(20).optional(), cur: z.string().length(3).optional() })
export const quoteBody = z
  .object({
    to: z.string().length(2),
    city: z.string().max(60).optional(),
    currency: z.string().length(3),
    groups: z.array(z.object({ brandId: z.string(), lines: z.array(z.object({ productId: z.string(), variantId: z.string(), qty: z.number().int().min(1).max(20) }).strict()).min(1) }).strict()).min(1).max(20),
  })
  .strict()

/** POST /api/orders/register: no ids, references, brand ids or customer ids in the body (SEC-5). */
export const registerOrderBody = z
  .object({
    idempotencyKey: z.string().min(8).max(80),
    currency: z.string().length(3),
    shipTo: z.object({ country: z.string().length(2), city: z.string().max(60).optional() }).strict(),
    groups: z.array(z.object({ lines: z.array(z.object({ productId: z.string(), variantId: z.string(), qty: z.number().int().min(1).max(20) }).strict()).min(1), service: z.enum(SHIPPING_SERVICES), quoteToken: z.string().max(2000) }).strict()).min(1).max(20),
  })
  .strict()

export const shipmentEventBody = z
  .object({ status: z.enum(SHIPMENT_STATUSES), occurredAt: z.string().optional(), carrier: z.string().max(60).optional(), trackingNumber: z.string().max(80).optional(), note: z.string().max(280).optional() })
  .strict()
export const complaintBody = z.object({ kind: z.enum(COMPLAINT_KINDS), details: z.string().max(1000) }).strict()
export const complaintResponseBody = z.object({ message: z.string().min(1).max(1000) }).strict()

export const shippingProfileBody = z
  .object({
    originCountry: z.string().length(2),
    originCity: z.string().min(1).max(60),
    handlingMin: z.number().int().min(0).max(30),
    handlingMax: z.number().int().min(0).max(30),
    cutoffLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    workdays: z.number().int().min(1).max(127),
    localPickup: z.boolean(),
    pickupLocationId: z.string().nullable(),
    zones: z.array(
      z
        .object({
          name: z.string().min(1).max(40),
          kind: z.enum(ZONE_KINDS),
          countries: z.array(z.string()).min(1),
          enabled: z.boolean(),
          methods: z.array(
            z
              .object({
                service: z.enum(SHIPPING_SERVICES),
                label: z.string().min(1).max(40),
                enabled: z.boolean(),
                transitMin: z.number().int().min(0).max(60),
                transitMax: z.number().int().min(0).max(60),
                carrierLabel: z.string().max(40).nullable().optional(),
                rates: z.array(z.object({ minSubtotalMinor: z.number().int().min(0), amountMinor: z.number().int().min(0) }).strict()).min(1),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    closures: z.array(z.object({ dateFrom: z.string(), dateTo: z.string(), reason: z.string().max(80).nullable().optional() }).strict()).max(20),
  })
  .strict()

/** Payloads this feature publishes (imported by contracts/realtime.ts). */
export const shippingRealtimeEvents = {
  "order.estimate": z.object({ orderId: z.string(), estimate: estimateDto }),
}
