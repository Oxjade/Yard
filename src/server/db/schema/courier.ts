import { bigint, boolean, check, date, index, integer, jsonb, pgTable, smallint, text, uniqueIndex } from "drizzle-orm/pg-core"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { orderRefs } from "./orders"

/**
 * Courier aggregator shipping (docs/SHIPPING.md): a brand's pickup address and parcel defaults,
 * cached live rate quotes, booked courier shipments and the provider event log.
 *
 * Plain Node (no server-only, no @/ aliases): drizzle-kit and `tsx --test` load this file.
 * Money is integer minor units plus an ISO currency code.
 */

export const COURIER_PROVIDERS = ["shipbubble", "topship", "mock"] as const
export const COURIER_SHIPMENT_STATES = ["booking", "booked", "in_transit", "delivered", "cancelled", "failed", "needs_review"] as const
export const COURIER_EVENT_KINDS = ["webhook", "quote_failed", "book_failed", "track_failed", "wallet_failed", "price_over_cap", "wallet_low", "unmatched"] as const

/** One row per brand: where couriers collect from, and the parcel used when a product has no weight. */
export const courierSettings = pgTable(
  "courier_settings",
  {
    brandId: text("brand_id")
      .primaryKey()
      .references(() => brands.id),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email").notNull(),
    /** One line, as the provider's address validation takes it ("12 Bode Thomas St, Surulere"). */
    address: text("address").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull().default(""),
    country: text("country").notNull().default("NG"),
    /** The provider that validated the address and its code for it (Shipbubble: address_code). */
    provider: text("provider"),
    providerAddressCode: text("provider_address_code"),
    formattedAddress: text("formatted_address"),
    verifiedAt: tz("verified_at"),
    /** Packed weight per piece for products with no weight of their own, and the box size. */
    parcelWeightGrams: integer("parcel_weight_grams").notNull().default(500),
    parcelLengthCm: smallint("parcel_length_cm").notNull().default(30),
    parcelWidthCm: smallint("parcel_width_cm").notNull().default(25),
    parcelHeightCm: smallint("parcel_height_cm").notNull().default(10),
    updatedBy: text("updated_by"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  () => [
    check("courier_settings_weight_ck", raw("parcel_weight_grams between 10 and 70000")),
    check("courier_settings_dims_ck", raw("parcel_length_cm between 1 and 300 and parcel_width_cm between 1 and 300 and parcel_height_cm between 1 and 300")),
    check("courier_settings_country_ck", raw("country ~ '^[A-Z]{2}$'")),
    check("courier_settings_len_ck", raw("length(address) between 5 and 300 and length(contact_name) between 1 and 120 and length(phone) between 6 and 30 and length(email) between 3 and 200")),
  ],
)

/**
 * A live rate request (one per brand group, destination and parcel), kept so the price the shopper
 * saw is the price checkout charges while it is fresh (`expires_at`), and so booking can reuse the
 * provider's request token. `options` holds the provider's couriers as Yard parsed them.
 */
export const courierQuotes = pgTable(
  "courier_quotes",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    provider: text("provider").notNull(),
    cacheKey: text("cache_key").notNull(),
    requestToken: text("request_token").notNull(),
    currency: text("currency").notNull(),
    options: jsonb("options").notNull(),
    /** The pickup date the rates were asked for (yyyy-mm-dd, Lagos). */
    pickupDate: date("pickup_date", { mode: "string" }),
    /** Until when checkout charges these prices. */
    expiresAt: tz("expires_at").notNull(),
    /** Until when the provider honours the request token (Shipbubble: 7 days). */
    tokenExpiresAt: tz("token_expires_at").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("courier_quotes_key_ix").on(t.cacheKey, t.expiresAt), index("courier_quotes_created_ix").on(t.createdAt), oneOf("courier_quotes_provider_ck", "provider", COURIER_PROVIDERS)],
)

/** One courier booking per order. The unique order row is what makes "Book pickup" idempotent. */
export const courierShipments = pgTable(
  "courier_shipments",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    provider: text("provider").notNull(),
    status: text("status").notNull().default("booking"),
    /** The provider's id for the shipment (Shipbubble: order_id). */
    providerOrderId: text("provider_order_id"),
    courierId: text("courier_id"),
    serviceCode: text("service_code"),
    courierName: text("courier_name"),
    trackingCode: text("tracking_code"),
    trackingUrl: text("tracking_url"),
    /** A printable waybill / label from the provider, when it gives one. */
    labelUrl: text("label_url"),
    currency: text("currency").notNull(),
    /** What the shopper paid for this courier rate. */
    collectedMinor: bigint("collected_minor", { mode: "number" }).notNull(),
    /** What the booking cost Yard's courier wallet (null until booked). */
    costMinor: bigint("cost_minor", { mode: "number" }),
    /** cost − collected when a re-quote changed the price (Yard absorbs it). */
    priceDiffMinor: bigint("price_diff_minor", { mode: "number" }).notNull().default(0),
    requoted: boolean("requoted").notNull().default(false),
    overCap: boolean("over_cap").notNull().default(false),
    providerStatus: text("provider_status"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    bookedBy: text("booked_by"),
    bookedAt: tz("booked_at"),
    lastEventAt: tz("last_event_at"),
    lastSyncedAt: tz("last_synced_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("courier_shipments_order_ux").on(t.orderRefId),
    uniqueIndex("courier_shipments_provider_order_ux").on(t.provider, t.providerOrderId).where(raw("provider_order_id is not null")),
    index("courier_shipments_status_ix").on(t.status, t.updatedAt),
    index("courier_shipments_brand_ix").on(t.brandId, t.createdAt),
    oneOf("courier_shipments_provider_ck", "provider", COURIER_PROVIDERS),
    oneOf("courier_shipments_status_ck", "status", COURIER_SHIPMENT_STATES),
    check("courier_shipments_amounts_ck", raw("collected_minor >= 0 and (cost_minor is null or cost_minor >= 0)")),
    check("courier_shipments_error_len_ck", raw("error is null or length(error) <= 300")),
  ],
)

/**
 * The provider log Admin › Delivery reads: every webhook (deduplicated by `event_key`), failed
 * quotes and bookings, re-quotes over the cap and low-wallet alerts. `detail` is Yard's own
 * wording or the provider's short message, never a whole payload.
 */
export const courierEvents = pgTable(
  "courier_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    kind: text("kind").notNull(),
    eventKey: text("event_key"),
    orderRefId: text("order_ref_id"),
    shipmentId: text("shipment_id"),
    status: text("status"),
    detail: text("detail"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("courier_events_key_ux").on(t.eventKey).where(raw("event_key is not null")),
    index("courier_events_kind_ix").on(t.kind, t.createdAt),
    index("courier_events_created_ix").on(t.createdAt),
    oneOf("courier_events_kind_ck", "kind", COURIER_EVENT_KINDS),
    check("courier_events_detail_len_ck", raw("detail is null or length(detail) <= 500")),
  ],
)
