import { boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { COMPLAINT_KINDS, COMPLAINT_STATUSES, ESTIMATE_BASES, ORDER_REF_SOURCES, SHIPMENT_SOURCES, SHIPMENT_STATUSES, SHIPPING_SERVICES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { users } from "./people"

/** A checkout across brands. Browser checkouts get server-minted ids and references (§3.7, §6.5). */
export const orderGroups = pgTable(
  "order_groups",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    reference: text("reference").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_groups_reference_ux").on(t.reference),
    uniqueIndex("order_groups_idempotency_ux").on(t.customerId, t.idempotencyKey).where(raw("idempotency_key is not null")),
  ],
)

export type OrderRefItem = { productId: string; variantId: string; name: string; qty: number; unitMinor: number }

/** The server mirror of an order (one brand's part of a checkout). Never chosen by a client. */
export const orderRefs = pgTable(
  "order_refs",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => orderGroups.id),
    reference: text("reference").notNull(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    placedAt: tz("placed_at").notNull(),
    /** MerchantOrderStatus. */
    status: text("status").notNull(),
    paid: boolean("paid").notNull().default(false),
    currency: text("currency").notNull(),
    subtotalMinor: integer("subtotal_minor").notNull(),
    shippingMinor: integer("shipping_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    items: jsonb("items").$type<OrderRefItem[]>().notNull(),
    shipToCountry: text("ship_to_country").notNull(),
    shipToCity: text("ship_to_city"),
    service: text("service").notNull().default("standard"),
    /** The option the shopper saw: price, transit, providerId. */
    quoted: jsonb("quoted"),
    source: text("source").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("order_refs_brand_placed_ix").on(t.brandId, t.placedAt.desc()),
    index("order_refs_customer_placed_ix").on(t.customerId, t.placedAt.desc()),
    uniqueIndex("order_refs_brand_reference_ux").on(t.brandId, t.reference),
    oneOf("order_refs_service_ck", "service", SHIPPING_SERVICES),
    oneOf("order_refs_source_ck", "source", ORDER_REF_SOURCES),
  ],
)

/** The newest row per order is its current estimate. */
export const deliveryEstimates = pgTable(
  "delivery_estimates",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id, { onDelete: "cascade" }),
    basis: text("basis").notNull(),
    dispatchFrom: date("dispatch_from", { mode: "string" }),
    shipBy: date("ship_by", { mode: "string" }),
    arrivalFrom: date("arrival_from", { mode: "string" }),
    arrivalTo: date("arrival_to", { mode: "string" }),
    deliveredOn: date("delivered_on", { mode: "string" }),
    guaranteed: boolean("guaranteed").notNull().default(false),
    providerId: text("provider_id").notNull(),
    reason: text("reason"),
    computedAt: tz("computed_at").notNull().defaultNow(),
  },
  (t) => [index("delivery_estimates_order_ix").on(t.orderRefId, t.computedAt.desc()), oneOf("delivery_estimates_basis_ck", "basis", ESTIMATE_BASES)],
)

export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    occurredAt: tz("occurred_at").notNull(),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    locationText: text("location_text"),
    note: text("note"),
    source: text("source").notNull(),
    createdBy: text("created_by"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("shipment_events_order_ix").on(t.orderRefId, t.occurredAt),
    oneOf("shipment_events_status_ck", "status", SHIPMENT_STATUSES),
    oneOf("shipment_events_source_ck", "source", SHIPMENT_SOURCES),
  ],
)

export const deliveryComplaints = pgTable(
  "delivery_complaints",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id),
    /** Copied from the order_ref, never from a request body. */
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    kind: text("kind").notNull(),
    details: text("details").notNull().default(""),
    status: text("status").notNull().default("open"),
    brandResponse: text("brand_response"),
    resolution: text("resolution"),
    createdAt: tz("created_at").notNull().defaultNow(),
    resolvedAt: tz("resolved_at"),
    resolvedBy: text("resolved_by"),
  },
  (t) => [
    index("delivery_complaints_status_ix").on(t.status, t.createdAt),
    index("delivery_complaints_brand_ix").on(t.brandId),
    index("delivery_complaints_order_ix").on(t.orderRefId),
    oneOf("delivery_complaints_kind_ck", "kind", COMPLAINT_KINDS),
    oneOf("delivery_complaints_status_ck", "status", COMPLAINT_STATUSES),
    check("delivery_complaints_details_len_ck", raw("length(details) <= 1000")),
  ],
)
