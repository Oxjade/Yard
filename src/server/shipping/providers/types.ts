import "server-only"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import type { shippingMethods, shippingProfiles, shippingRates, shippingZones } from "../../db/schema"

/**
 * The shipping provider abstraction (§6.5). Every rate and transit time a shopper sees comes
 * through one of these. The manual provider prices from the brand's own zones and tiers; a future
 * carrier plugs in behind the same interface for live rates, tracking and labels.
 */

export type ShippingProfileRow = typeof shippingProfiles.$inferSelect
export type ZoneRow = typeof shippingZones.$inferSelect
export type MethodRow = typeof shippingMethods.$inferSelect
export type RateRow = typeof shippingRates.$inferSelect

export type ZoneWithMethods = ZoneRow & { methods: (MethodRow & { rates: RateRow[] })[] }

/** The brand's pickup point, when it has a published, approved store or showroom set. */
export type PickupPoint = { id: string; name: string; area: string; citySlug: string }

export type QuoteRequest = {
  brandId: string
  profile: ShippingProfileRow
  zones: ZoneWithMethods[]
  pickup: PickupPoint | null
  destination: { country: CountryCode; citySlug?: string | null }
  /** In the brand's currency. */
  subtotal: { amount: number; currency: CurrencyCode }
  lines: { productId: string; qty: number }[]
}

export type QuoteOption = {
  methodId: string
  service: "standard" | "express" | "pickup"
  label: string
  available: boolean
  reason?: string
  /** In the brand's currency. */
  price: { amount: number; currency: CurrencyCode }
  free: boolean
  /** The brand-currency subtotal above which this option is free. */
  freeOver?: { amount: number; currency: CurrencyCode }
  transit: [number, number]
  providerId: string
  /** Only a carrier that declares `guaranteedDates` and returns a date may set this; none does in this build. */
  guaranteed: false
  pickup?: { name: string; area: string }
}

/** A tracking update from a carrier (future: feeds shipment_events with source 'carrier'). */
export type CarrierEvent = { status: "label_created" | "shipped" | "in_transit" | "out_for_delivery" | "delivered" | "exception" | "returned"; occurredAt: string; locationText?: string }

export type CreateShipmentRequest = { orderRefId: string; brandId: string; service: QuoteOption["service"]; destination: { country: CountryCode; city?: string | null } }

export interface ShippingProvider {
  id: string
  label: string
  kind: "manual" | "carrier"
  capabilities: { rates: boolean; estimates: boolean; tracking: boolean; labels: boolean; guaranteedDates: boolean }
  isConfigured(): boolean
  quote(req: QuoteRequest): Promise<QuoteOption[]>
  track?(req: { carrier: string; trackingNumber: string }): Promise<CarrierEvent[]>
  createShipment?(req: CreateShipmentRequest): Promise<{ trackingNumber: string; labelUrl: string }>
}

/** A provider asked to do something it has no keys or contract for. */
export class ProviderNotConfigured extends Error {
  constructor(public providerId: string) {
    super(`Shipping provider ${providerId} isn't configured`)
    this.name = "ProviderNotConfigured"
  }
}
