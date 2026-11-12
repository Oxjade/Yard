import { bigint, boolean, check, index, integer, jsonb, pgTable, smallint, text, uniqueIndex } from "drizzle-orm/pg-core"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { users } from "./people"

/**
 * CHECKOUT (v3): server carts, checkouts, Paystack payments, refunds, transfers and the raw
 * provider event log. Money is integer minor units + an ISO currency code (bigint read as a JS
 * number: every amount Yard handles is far below 2^53). Other areas' tables are reached only
 * through their contract functions, never by foreign key, except the core people/brands tables.
 */

export const CHECKOUT_STATUSES = ["pending_payment", "paid", "failed", "expired", "review"] as const
export const PAYMENT_STATUSES = ["initialized", "succeeded", "failed", "abandoned", "review"] as const
export const PAYMENT_PROVIDERS = ["paystack", "bachs", "stub"] as const
export const REFUND_STATUSES = ["pending", "succeeded", "failed"] as const
export const TRANSFER_STATUSES = ["pending", "succeeded", "failed"] as const
export const PROVIDER_EVENT_STATUSES = ["received", "processed", "ignored", "failed"] as const
export const PROVIDER_EVENT_SOURCES = ["webhook", "verify", "simulated"] as const

/**
 * One cart per signed-in shopper (customer_id) or per anonymous browser (anon_key =
 * sha256 of the yard_cart cookie token; the raw token is never stored). Exactly one is set.
 */
export const carts = pgTable(
  "carts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id").references(() => users.id, { onDelete: "cascade" }),
    anonKey: text("anon_key"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("carts_customer_ux").on(t.customerId).where(raw("customer_id is not null")),
    uniqueIndex("carts_anon_ux").on(t.anonKey).where(raw("anon_key is not null")),
    index("carts_updated_ix").on(t.updatedAt),
    check("carts_owner_ck", raw("(customer_id is null) <> (anon_key is null)")),
  ],
)

/** Variant ids and quantities only: prices are always re-read from CATALOG when the cart is shown. */
export const cartLines = pgTable(
  "cart_lines",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull(),
    qty: smallint("qty").notNull(),
    addedAt: tz("added_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cart_lines_variant_ux").on(t.cartId, t.variantId), check("cart_lines_qty_ck", raw("qty between 1 and 20"))],
)

/**
 * One checkout attempt: idempotent per (customer, idempotency_key). `request_hash` is the hash of
 * the normalised request, so a reused key with a different cart is a 409. `groups` is the priced
 * snapshot handed to ORDERS; `hold_key` names the CATALOG stock hold (the checkout id).
 */
export const checkouts = pgTable(
  "checkouts",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull().default("pending_payment"),
    currency: text("currency").notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    shippingMinor: bigint("shipping_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    holdKey: text("hold_key").notNull(),
    reference: text("reference"),
    orderIds: jsonb("order_ids").$type<string[]>().notNull().default([]),
    groups: jsonb("groups").$type<unknown>().notNull(),
    shipTo: jsonb("ship_to").$type<unknown>().notNull(),
    cartId: text("cart_id"),
    failureReason: text("failure_reason"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    expiresAt: tz("expires_at").notNull(),
    paidAt: tz("paid_at"),
  },
  (t) => [
    uniqueIndex("checkouts_idem_ux").on(t.customerId, t.idempotencyKey),
    index("checkouts_customer_ix").on(t.customerId, t.createdAt),
    index("checkouts_status_exp_ix").on(t.status, t.expiresAt),
    oneOf("checkouts_status_ck", "status", CHECKOUT_STATUSES),
    check("checkouts_amounts_ck", raw("subtotal_minor >= 0 and shipping_minor >= 0 and total_minor = subtotal_minor + shipping_minor")),
  ],
)

/**
 * A provider transaction for a checkout. `reference` is ours (sent to Paystack, unique);
 * `provider_txn_id` is Paystack's numeric id once known. One live payment per checkout; a new
 * one is created only after the previous one failed or was abandoned.
 */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    checkoutId: text("checkout_id")
      .notNull()
      .references(() => checkouts.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    reference: text("reference").notNull(),
    status: text("status").notNull().default("initialized"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    accessCode: text("access_code"),
    authorizationUrl: text("authorization_url"),
    providerTxnId: text("provider_txn_id"),
    channel: text("channel"),
    /** Split / subaccount code applied at initialise (null while split is off). */
    splitCode: text("split_code"),
    initError: text("init_error"),
    failureReason: text("failure_reason"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    paidAt: tz("paid_at"),
  },
  (t) => [
    uniqueIndex("payments_reference_ux").on(t.reference),
    index("payments_checkout_ix").on(t.checkoutId),
    uniqueIndex("payments_checkout_live_ux").on(t.checkoutId).where(raw("status in ('initialized', 'succeeded', 'review')")),
    oneOf("payments_status_ck", "status", PAYMENT_STATUSES),
    oneOf("payments_provider_ck", "provider", PAYMENT_PROVIDERS),
    check("payments_amount_ck", raw("amount_minor > 0")),
  ],
)

/** Refunds against a payment, per order. Idempotent by key; never more than the payment in total (checked in requestRefund). */
export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    orderId: text("order_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refunds_idem_ux").on(t.idempotencyKey),
    index("refunds_payment_ix").on(t.paymentId),
    index("refunds_order_ix").on(t.orderId),
    index("refunds_provider_ref_ix").on(t.providerRef),
    oneOf("refunds_status_ck", "status", REFUND_STATUSES),
    oneOf("refunds_provider_ck", "provider", PAYMENT_PROVIDERS),
    check("refunds_amount_ck", raw("amount_minor > 0")),
  ],
)

/** Payout transfers (LEDGER calls initiatePayout). One row per payout id; `reference` is deterministic from it. */
export const transfers = pgTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    payoutId: text("payout_id").notNull(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    recipientCode: text("recipient_code").notNull(),
    reference: text("reference").notNull(),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    status: text("status").notNull().default("pending"),
    failureReason: text("failure_reason"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transfers_payout_ux").on(t.payoutId),
    uniqueIndex("transfers_reference_ux").on(t.reference),
    index("transfers_brand_ix").on(t.brandId, t.createdAt),
    oneOf("transfers_status_ck", "status", TRANSFER_STATUSES),
    oneOf("transfers_provider_ck", "provider", PAYMENT_PROVIDERS),
    check("transfers_amount_ck", raw("amount_minor > 0")),
  ],
)

/**
 * Raw provider events, stored before processing (signature already verified). `event_key`
 * dedupes provider retries; `raw_body` is the exact bytes that were signed, so a replay
 * re-processes exactly what arrived.
 */
export const providerEvents = pgTable(
  "provider_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    source: text("source").notNull().default("webhook"),
    eventType: text("event_type").notNull(),
    eventKey: text("event_key").notNull(),
    bodySha256: text("body_sha256").notNull(),
    rawBody: text("raw_body").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** What the event was about, for admin search: a payment / refund / transfer reference. */
    subjectRef: text("subject_ref"),
    receivedAt: tz("received_at").notNull().defaultNow(),
    processedAt: tz("processed_at"),
    lastReplayBy: text("last_replay_by"),
  },
  (t) => [
    uniqueIndex("provider_events_key_ux").on(t.provider, t.eventKey),
    index("provider_events_status_ix").on(t.status, t.receivedAt),
    index("provider_events_type_ix").on(t.eventType, t.receivedAt),
    index("provider_events_subject_ix").on(t.subjectRef),
    oneOf("provider_events_status_ck", "status", PROVIDER_EVENT_STATUSES),
    oneOf("provider_events_source_ck", "source", PROVIDER_EVENT_SOURCES),
  ],
)
