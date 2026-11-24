/**
 * The courier aggregator interface (docs/SHIPPING.md). One adapter per aggregator (Shipbubble
 * today; Topship once its API is documented) sits behind it, chosen by YARD_SHIPPING_PROVIDER.
 *
 * Plain TypeScript (no server-only): the pure parsing in the adapters' *-core.ts files and the
 * tests import these types directly. Money is integer minor units (kobo for NGN).
 */

export type CourierProviderId = "shipbubble" | "topship"

/** A person and place, as the aggregators' address validation takes them. */
export type CourierAddress = {
  name: string
  email: string
  phone: string
  /** One line: street, area, city and state ("12 Bode Thomas St, Surulere, Lagos"). */
  address: string
  city?: string
  state?: string
  country: string
}

/** The aggregator's id for a validated address (Shipbubble: address_code). */
export type ValidatedAddress = { code: string; formatted: string | null }

export type ParcelItem = { name: string; description: string; unitWeightGrams: number; unitAmountMinor: number; quantity: number }

export type Parcel = {
  items: ParcelItem[]
  /** Box dimensions in centimetres. */
  lengthCm: number
  widthCm: number
  heightCm: number
}

export type QuoteInput = {
  senderCode: string
  receiverCode: string
  /** yyyy-mm-dd: when the courier should collect. */
  pickupDate: string
  parcel: Parcel
  /** The provider's package category, when the adapter needs one (Shipbubble: category_id). */
  categoryId?: string | null
}

/** One courier and service the aggregator priced. */
export type CourierRate = {
  courierId: string
  serviceCode: string
  courierName: string
  courierImage: string | null
  /** What booking this rate costs Yard's wallet (minor units of `currency`). */
  amountMinor: number
  currency: string
  /** The provider's own words for when it arrives ("Within 2 - 4 working days"), if any. */
  deliveryEta: string | null
  /** Business days in transit when the ETA could be read as days; null otherwise. */
  transitDays: [number, number] | null
  /** "pickup" (the courier collects) or "dropoff" (the brand drops it at a station), when stated. */
  serviceType: string | null
}

export type CourierQuote = { requestToken: string; rates: CourierRate[]; currency: string }

export type CourierBooking = {
  providerOrderId: string
  status: CourierStatus | null
  providerStatus: string | null
  courierName: string | null
  trackingCode: string | null
  trackingUrl: string | null
  labelUrl: string | null
  /** What the provider charged, when the response says (else the quoted amount stands). */
  costMinor: number | null
  currency: string | null
}

/** Yard's reading of a provider's shipment status. */
export type CourierStatus = "pending" | "confirmed" | "picked_up" | "in_transit" | "delivered" | "cancelled" | "unknown"

export type CourierTracking = {
  providerOrderId: string
  status: CourierStatus
  providerStatus: string | null
  trackingCode: string | null
  trackingUrl: string | null
  labelUrl: string | null
  /** When the newest status happened (ISO), when the provider says. */
  occurredAt: string | null
  location: string | null
}

export type CourierWebhook = CourierTracking & { event: string | null }

export type WalletBalance = { amountMinor: number; currency: string }

/** A provider call that failed. `retryable` is false for a definite refusal (bad request, auth). */
export class CourierError extends Error {
  constructor(
    message: string,
    public readonly kind: "auth" | "refused" | "unavailable" | "bad_response" | "not_configured",
    public readonly status: number | null = null,
  ) {
    super(message)
    this.name = "CourierError"
  }
  /** The request may have reached the provider and done something (a timeout, a 5xx, an unreadable answer). */
  get ambiguous() {
    return this.kind === "unavailable" || this.kind === "bad_response"
  }
}

export interface CourierProvider {
  id: CourierProviderId
  label: string
  /** True for a sandbox/test key: no real courier is booked and no money moves. */
  sandbox: boolean
  validateAddress(a: CourierAddress): Promise<ValidatedAddress>
  quote(input: QuoteInput): Promise<CourierQuote>
  /** Books the chosen rate. Shipbubble needs the quote's request token with the courier and service. */
  book(rate: { requestToken: string; courierId: string; serviceCode: string }): Promise<CourierBooking>
  track(providerOrderId: string): Promise<CourierTracking>
  /** True when the raw body carries a valid signature for this provider. */
  verifyWebhook(rawBody: string, headers: Headers): boolean
  parseWebhook(rawBody: string): CourierWebhook
  /** The prepaid wallet's balance, when the provider's API offers it (read-only). */
  walletBalance?(): Promise<WalletBalance>
  /** How long the provider honours a quote's request token. */
  tokenTtlMs: number
}
