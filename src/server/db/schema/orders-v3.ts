import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { orderRefs } from "./orders"
import { users } from "./people"

/**
 * ORDERS v3: one orders model on top of shipping's `order_refs` (the order row itself, its group,
 * reference, totals and merchant status stay there, so delivery estimates, shipment events and
 * complaints keep working). These tables add what an order needs for money: separate payment,
 * fulfilment and return states, priced lines, a timeline, returns, refunds and disputes.
 *
 * Plain Node (no server-only, no @/ aliases): drizzle-kit loads this file outside Next. Money is
 * integer minor units plus an ISO currency code, never floats.
 */

export const PAYMENT_STATES = ["pending", "paid", "failed", "partially_refunded", "refunded"] as const
export const FULFILMENT_STATES = ["unfulfilled", "processing", "shipped", "delivered", "returned_to_sender", "cancelled"] as const
export const RETURN_STATES = ["none", "requested", "approved", "received", "rejected", "cancelled", "expired"] as const
export const DISPUTE_FLAGS = ["none", "open", "won", "lost"] as const
export const RETURN_REQUEST_STATES = ["requested", "approved", "rejected", "received", "cancelled", "expired"] as const
export const OPEN_RETURN_STATES = ["requested", "approved"] as const
export const RETURN_REASONS = ["too_small", "too_large", "not_as_described", "damaged", "wrong_item", "unwanted", "other"] as const
export const REFUND_KINDS = ["return", "cancellation", "goodwill", "dispute", "platform"] as const
export const REFUND_STATES = ["pending", "succeeded", "failed"] as const
export const DISPUTE_STATES = ["open", "awaiting_response", "under_review", "won", "lost", "closed"] as const
export const ORDER_ACTOR_KINDS = ["shopper", "brand", "admin", "system", "provider"] as const
export const CANCEL_BY = ["shopper", "brand", "admin", "system"] as const

export type OrderShipTo = { name?: string; line1?: string; line2?: string; city?: string; region?: string; postcode?: string; country: string; phone?: string }

/** One row per order_ref created by checkout (legacy/seed order_refs have none until first touched). */
export const orderStates = pgTable(
  "order_states",
  {
    orderRefId: text("order_ref_id")
      .primaryKey()
      .references(() => orderRefs.id, { onDelete: "cascade" }),
    /** CHECKOUT's checkout id; null for orders that existed before v3 checkout. */
    checkoutId: text("checkout_id"),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    currency: text("currency").notNull(),
    totalMinor: integer("total_minor").notNull(),
    paymentStatus: text("payment_status").notNull().default("pending"),
    fulfilmentStatus: text("fulfilment_status").notNull().default("unfulfilled"),
    returnStatus: text("return_status").notNull().default("none"),
    disputeStatus: text("dispute_status").notNull().default("none"),
    /** PAYMENTS' payment id, set by markCheckoutPaid. */
    paymentId: text("payment_id"),
    paidAt: tz("paid_at"),
    paymentFailedReason: text("payment_failed_reason"),
    /** Sum of succeeded refunds (pending ones are counted from order_refunds when capping). */
    refundedMinor: integer("refunded_minor").notNull().default(0),
    /** The full delivery address (the brand needs it to ship; erased with the shopper's account). */
    shipTo: jsonb("ship_to").$type<OrderShipTo | null>(),
    /** CHECKOUT released the stock hold (payment failed/expired): a late capture is refunded without restocking. */
    stockReleased: boolean("stock_released").notNull().default(false),
    cancelledAt: tz("cancelled_at"),
    cancelledBy: text("cancelled_by"),
    cancelReason: text("cancel_reason"),
    deliveredAt: tz("delivered_at"),
    returnWindowEndsAt: tz("return_window_ends_at"),
    /** Set when LEDGER postOrderCompleted ran (or the order closed with nothing to settle). */
    completedAt: tz("completed_at"),
    version: integer("version").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("order_states_checkout_ix").on(t.checkoutId),
    index("order_states_payment_ix").on(t.paymentId),
    index("order_states_brand_ix").on(t.brandId, t.createdAt.desc()),
    index("order_states_customer_ix").on(t.customerId, t.createdAt.desc()),
    index("order_states_completion_ix").on(t.returnWindowEndsAt).where(raw("completed_at is null")),
    oneOf("order_states_payment_ck", "payment_status", PAYMENT_STATES),
    oneOf("order_states_fulfilment_ck", "fulfilment_status", FULFILMENT_STATES),
    oneOf("order_states_return_ck", "return_status", RETURN_STATES),
    oneOf("order_states_dispute_ck", "dispute_status", DISPUTE_FLAGS),
    check("order_states_total_ck", raw("total_minor >= 0")),
    check("order_states_refunded_ck", raw("refunded_minor >= 0 and refunded_minor <= total_minor")),
    check("order_states_cancel_by_ck", raw(`cancelled_by is null or cancelled_by in (${CANCEL_BY.map((v) => `'${v}'`).join(", ")})`)),
  ],
)

/** An order's priced lines (order_refs.items keeps its copy for shipping). */
export const orderLines = pgTable(
  "order_lines",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull(),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    qty: integer("qty").notNull(),
    unitMinor: integer("unit_minor").notNull(),
    currency: text("currency").notNull(),
    /** Units that came back on a received return. */
    returnedQty: integer("returned_qty").notNull().default(0),
    /** Units put back into stock (return received with restock, or a cancellation). */
    restockedQty: integer("restocked_qty").notNull().default(0),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("order_lines_order_variant_ux").on(t.orderRefId, t.variantId),
    check("order_lines_qty_ck", raw("qty > 0")),
    check("order_lines_unit_ck", raw("unit_minor >= 0")),
    check("order_lines_returned_ck", raw("returned_qty >= 0 and returned_qty <= qty")),
    check("order_lines_restocked_ck", raw("restocked_qty >= 0 and restocked_qty <= qty")),
  ],
)

/** The order timeline, append-only. `data` never holds user-written text or card data. */
export const orderEvents = pgTable(
  "order_events",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: tz("at").notNull().defaultNow(),
  },
  (t) => [index("order_events_order_ix").on(t.orderRefId, t.at), oneOf("order_events_actor_ck", "actor_kind", ORDER_ACTOR_KINDS)],
)

export const orderReturns = pgTable(
  "order_returns",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    idempotencyKey: text("idempotency_key").notNull(),
    requestedAt: tz("requested_at").notNull().defaultNow(),
    decidedAt: tz("decided_at"),
    decidedByKind: text("decided_by_kind"),
    decidedBy: text("decided_by"),
    decisionReason: text("decision_reason"),
    receivedAt: tz("received_at"),
    receivedBy: text("received_by"),
    restocked: integer("restocked").notNull().default(0),
    /** The order_refunds row a received return produced, when it did. */
    refundId: text("refund_id"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("order_returns_order_ix").on(t.orderRefId, t.requestedAt.desc()),
    index("order_returns_brand_status_ix").on(t.brandId, t.status),
    uniqueIndex("order_returns_idempotency_ux").on(t.customerId, t.idempotencyKey),
    // One open return per order at a time.
    uniqueIndex("order_returns_open_ux").on(t.orderRefId).where(raw(`status in (${OPEN_RETURN_STATES.map((v) => `'${v}'`).join(", ")})`)),
    oneOf("order_returns_status_ck", "status", RETURN_REQUEST_STATES),
    oneOf("order_returns_reason_ck", "reason", RETURN_REASONS),
    check("order_returns_note_len_ck", raw("length(note) <= 1000")),
  ],
)

export const orderReturnLines = pgTable(
  "order_return_lines",
  {
    id: text("id").primaryKey(),
    returnId: text("return_id")
      .notNull()
      .references(() => orderReturns.id, { onDelete: "cascade" }),
    orderLineId: text("order_line_id")
      .notNull()
      .references(() => orderLines.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
  },
  (t) => [uniqueIndex("order_return_lines_ux").on(t.returnId, t.orderLineId), check("order_return_lines_qty_ck", raw("qty > 0"))],
)

/**
 * Every refund on an order. The cap (never over-refund) is checked under a row lock on
 * order_states: pending + succeeded refunds never exceed the order total.
 */
export const orderRefunds = pgTable(
  "order_refunds",
  {
    id: text("id").primaryKey(),
    orderRefId: text("order_ref_id")
      .notNull()
      .references(() => orderRefs.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    returnId: text("return_id").references(() => orderReturns.id),
    disputeId: text("dispute_id"),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    reason: text("reason").notNull(),
    /** Unique per order: a retried request returns the same refund. */
    idempotencyKey: text("idempotency_key").notNull(),
    /** PAYMENTS' refund id (requestRefund), null for dispute losses the provider took directly. */
    paymentRefundId: text("payment_refund_id"),
    requestedByKind: text("requested_by_kind").notNull(),
    requestedBy: text("requested_by"),
    ledgerPostedAt: tz("ledger_posted_at"),
    failureReason: text("failure_reason"),
    createdAt: tz("created_at").notNull().defaultNow(),
    settledAt: tz("settled_at"),
  },
  (t) => [
    index("order_refunds_order_ix").on(t.orderRefId, t.createdAt),
    uniqueIndex("order_refunds_idempotency_ux").on(t.orderRefId, t.idempotencyKey),
    uniqueIndex("order_refunds_payment_refund_ux").on(t.paymentRefundId).where(raw("payment_refund_id is not null")),
    index("order_refunds_status_ix").on(t.status),
    oneOf("order_refunds_kind_ck", "kind", REFUND_KINDS),
    oneOf("order_refunds_status_ck", "status", REFUND_STATES),
    oneOf("order_refunds_by_ck", "requested_by_kind", ORDER_ACTOR_KINDS),
    check("order_refunds_amount_ck", raw("amount_minor > 0")),
  ],
)

/**
 * Payment disputes (chargebacks), filled by the provider webhook through handleDisputeEvent. One
 * provider transaction can pay for several brands' orders, so a dispute lists every order it covers.
 */
export const orderDisputes = pgTable(
  "order_disputes",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerDisputeId: text("provider_dispute_id").notNull(),
    checkoutId: text("checkout_id"),
    paymentId: text("payment_id"),
    orderRefIds: text("order_ref_ids").array().notNull().default(raw("'{}'::text[]")),
    brandIds: text("brand_ids").array().notNull().default(raw("'{}'::text[]")),
    status: text("status").notNull().default("open"),
    category: text("category"),
    amountMinor: integer("amount_minor").notNull().default(0),
    currency: text("currency").notNull(),
    evidenceDueAt: tz("evidence_due_at"),
    /** The brand's account of the order for Yard to submit (plain text; admins submit to the provider). */
    brandEvidence: text("brand_evidence"),
    brandEvidenceAt: tz("brand_evidence_at"),
    adminNote: text("admin_note"),
    responseSubmittedAt: tz("response_submitted_at"),
    lastProviderEventId: text("last_provider_event_id"),
    openedAt: tz("opened_at").notNull().defaultNow(),
    resolvedAt: tz("resolved_at"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("order_disputes_provider_ux").on(t.provider, t.providerDisputeId),
    index("order_disputes_status_ix").on(t.status, t.openedAt),
    index("order_disputes_checkout_ix").on(t.checkoutId),
    oneOf("order_disputes_status_ck", "status", DISPUTE_STATES),
    check("order_disputes_evidence_len_ck", raw("brand_evidence is null or length(brand_evidence) <= 4000")),
    check("order_disputes_note_len_ck", raw("admin_note is null or length(admin_note) <= 2000")),
  ],
)
