import { bigint, boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"

/**
 * LEDGER (backend v3): a double-entry ledger, per-order money state, brand payout settings and
 * bank accounts, payouts with two-admin approval, payout batches and reconciliation runs.
 *
 * Money is integer minor units (bigint read as a JS number, safe to 2^53) plus an ISO currency.
 * Order, payment, refund and checkout ids belong to other areas: they are stored as plain text
 * (no FK), so this file never imports another area's schema.
 */

export const LEDGER_OWNER_KINDS = ["brand", "platform"] as const
/**
 * brand_pending: captured sales still inside the order lifecycle / return window (liability).
 * brand_available: withdrawable (liability). brand_reserve: rolling reserve by tier (liability).
 * brand_payout_hold: requested payouts in review or in flight (liability).
 * platform_commission: commission revenue. platform_adjustments: manual corrections (equity).
 * provider_clearing: money held at the payment provider (asset, debit-normal).
 */
export const LEDGER_ACCOUNT_KINDS = ["brand_pending", "brand_available", "brand_reserve", "brand_payout_hold", "platform_commission", "platform_adjustments", "provider_clearing"] as const
export const LEDGER_TX_KINDS = [
  "payment_captured",
  "refund",
  "order_completed",
  "reserve_released",
  "payout_requested",
  "payout_cancelled",
  "payout_rejected",
  "payout_paid",
  "payout_failed",
  "payout_reversed",
  "adjustment",
] as const
export const ORDER_MONEY_STATUSES = ["captured", "completed", "refunded"] as const
export const BRAND_TIERS = ["new", "standard", "trusted"] as const
export const PAYOUT_STATUSES = ["requested", "awaiting_second_approval", "approved", "sending", "processing", "paid", "failed", "rejected", "cancelled"] as const
export const PAYOUT_BATCH_STATUSES = ["open", "running", "done", "partial"] as const
export const RECON_RUN_STATUSES = ["running", "ok", "mismatches", "failed"] as const
export const RECON_ITEM_KINDS = ["unbalanced_transaction", "balance_drift", "missing_in_ledger", "missing_at_provider", "amount_mismatch", "stuck_payout"] as const

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: text("id").primaryKey(),
    ownerKind: text("owner_kind").notNull(),
    /** brand id, or 'platform'. */
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    currency: text("currency").notNull(),
    /** 'debit' for provider_clearing, 'credit' for everything else. */
    normal: text("normal").notNull(),
    /** Cached balance in the account's normal direction; always equal to the sum of its entries. */
    balanceMinor: bigint("balance_minor", { mode: "number" }).notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_accounts_owner_kind_ccy_ux").on(t.ownerKind, t.ownerId, t.kind, t.currency),
    oneOf("ledger_accounts_owner_kind_ck", "owner_kind", LEDGER_OWNER_KINDS),
    oneOf("ledger_accounts_kind_ck", "kind", LEDGER_ACCOUNT_KINDS),
    oneOf("ledger_accounts_normal_ck", "normal", ["debit", "credit"]),
    check("ledger_accounts_currency_ck", raw("currency ~ '^[A-Z]{3}$'")),
  ],
)

export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    /** Makes every posting idempotent: capture:<paymentId>:<orderId>, refund:<refundId>, … */
    idempotencyKey: text("idempotency_key").notNull(),
    currency: text("currency").notNull(),
    brandId: text("brand_id"),
    orderId: text("order_id"),
    paymentId: text("payment_id"),
    refundId: text("refund_id"),
    payoutId: text("payout_id"),
    /** Fixed system wording only (never user-written text). */
    memo: text("memo"),
    actorKind: text("actor_kind").notNull().default("system"),
    actorId: text("actor_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_transactions_idem_ux").on(t.idempotencyKey),
    index("ledger_transactions_brand_ix").on(t.brandId, t.createdAt),
    index("ledger_transactions_order_ix").on(t.orderId),
    index("ledger_transactions_payment_ix").on(t.paymentId),
    index("ledger_transactions_refund_ix").on(t.refundId),
    index("ledger_transactions_payout_ix").on(t.payoutId),
    index("ledger_transactions_created_ix").on(t.createdAt),
    oneOf("ledger_transactions_kind_ck", "kind", LEDGER_TX_KINDS),
  ],
)

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: text("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    direction: text("direction").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_tx_ix").on(t.transactionId),
    index("ledger_entries_account_ix").on(t.accountId, t.createdAt),
    oneOf("ledger_entries_direction_ck", "direction", ["debit", "credit"]),
    check("ledger_entries_amount_ck", raw("amount_minor > 0")),
  ],
)

/** One row per paid order: what was captured, where the brand's share sits now, and what was refunded. */
export const ledgerOrderMoney = pgTable(
  "ledger_order_money",
  {
    orderId: text("order_id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    currency: text("currency").notNull(),
    paymentId: text("payment_id").notNull(),
    grossMinor: bigint("gross_minor", { mode: "number" }).notNull(),
    commissionMinor: bigint("commission_minor", { mode: "number" }).notNull(),
    commissionBps: integer("commission_bps").notNull(),
    tier: text("tier").notNull(),
    reserveBps: integer("reserve_bps").notNull(),
    /** This order's share currently in brand_pending / brand_reserve. */
    pendingMinor: bigint("pending_minor", { mode: "number" }).notNull(),
    reserveMinor: bigint("reserve_minor", { mode: "number" }).notNull(),
    refundedMinor: bigint("refunded_minor", { mode: "number" }).notNull().default(0),
    commissionRefundedMinor: bigint("commission_refunded_minor", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("captured"),
    capturedAt: tz("captured_at").notNull().defaultNow(),
    completedAt: tz("completed_at"),
    reserveReleaseAt: tz("reserve_release_at"),
    reserveReleasedAt: tz("reserve_released_at"),
  },
  (t) => [
    index("ledger_order_money_brand_ix").on(t.brandId, t.status),
    index("ledger_order_money_payment_ix").on(t.paymentId),
    index("ledger_order_money_reserve_ix").on(t.reserveReleaseAt),
    oneOf("ledger_order_money_status_ck", "status", ORDER_MONEY_STATUSES),
    oneOf("ledger_order_money_tier_ck", "tier", BRAND_TIERS),
    check("ledger_order_money_amounts_ck", raw("gross_minor > 0 and commission_minor >= 0 and pending_minor >= 0 and reserve_minor >= 0 and refunded_minor between 0 and gross_minor")),
  ],
)

/** Admin-set finance settings per brand (tier and commission overrides, payout hold). */
export const ledgerBrandSettings = pgTable(
  "ledger_brand_settings",
  {
    brandId: text("brand_id")
      .primaryKey()
      .references(() => brands.id),
    tierOverride: text("tier_override"),
    commissionBpsOverride: integer("commission_bps_override"),
    payoutsOnHold: boolean("payouts_on_hold").notNull().default(false),
    holdReason: text("hold_reason"),
    updatedBy: text("updated_by"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  () => [
    oneOf("ledger_brand_settings_tier_ck", "coalesce(tier_override, 'standard')", BRAND_TIERS),
    check("ledger_brand_settings_bps_ck", raw("commission_bps_override is null or commission_bps_override between 0 and 5000")),
    check("ledger_brand_settings_reason_len_ck", raw("hold_reason is null or length(hold_reason) <= 300")),
  ],
)

/** A brand's bank account for payouts. The account number is sealed (AES-256-GCM, AAD binds it to the brand). */
export const brandPayoutAccounts = pgTable(
  "brand_payout_accounts",
  {
    brandId: text("brand_id")
      .primaryKey()
      .references(() => brands.id),
    country: text("country").notNull(),
    currency: text("currency").notNull(),
    bankCode: text("bank_code").notNull(),
    bankName: text("bank_name").notNull(),
    accountName: text("account_name").notNull(),
    accountNumberEnc: text("account_number_enc").notNull(),
    accountLast4: text("account_last4").notNull(),
    /** Provider transfer-recipient code; 'stub' recipients are never paid by a live provider. */
    recipientCode: text("recipient_code"),
    recipientProvider: text("recipient_provider").notNull().default("stub"),
    updatedBy: text("updated_by").notNull(),
    changedAt: tz("changed_at").notNull().defaultNow(),
  },
  () => [
    check("brand_payout_accounts_last4_ck", raw("account_last4 ~ '^[0-9]{4}$'")),
    check("brand_payout_accounts_currency_ck", raw("currency ~ '^[A-Z]{3}$'")),
    oneOf("brand_payout_accounts_provider_ck", "recipient_provider", ["stub", "paystack"]),
  ],
)

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    currency: text("currency").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    status: text("status").notNull().default("requested"),
    requestedBy: text("requested_by").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    recipientCode: text("recipient_code"),
    recipientProvider: text("recipient_provider"),
    batchId: text("batch_id"),
    providerRef: text("provider_ref"),
    attempts: integer("attempts").notNull().default(0),
    /** Fixed system wording (provider error class), never raw provider bodies. */
    lastError: text("last_error"),
    rejectedBy: text("rejected_by"),
    rejectReason: text("reject_reason"),
    requestedAt: tz("requested_at").notNull().defaultNow(),
    approvedAt: tz("approved_at"),
    sentAt: tz("sent_at"),
    paidAt: tz("paid_at"),
    failedAt: tz("failed_at"),
    closedAt: tz("closed_at"),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payouts_brand_idem_ux").on(t.brandId, t.idempotencyKey),
    index("payouts_brand_ix").on(t.brandId, t.requestedAt),
    index("payouts_status_ix").on(t.status, t.requestedAt),
    index("payouts_batch_ix").on(t.batchId),
    index("payouts_provider_ref_ix").on(t.providerRef),
    oneOf("payouts_status_ck", "status", PAYOUT_STATUSES),
    check("payouts_amount_ck", raw("amount_minor > 0")),
    check("payouts_reason_len_ck", raw("reject_reason is null or length(reject_reason) <= 500")),
  ],
)

export const payoutApprovals = pgTable(
  "payout_approvals",
  {
    id: text("id").primaryKey(),
    payoutId: text("payout_id")
      .notNull()
      .references(() => payouts.id),
    adminId: text("admin_id").notNull(),
    adminName: text("admin_name").notNull(),
    step: integer("step").notNull(),
    note: text("note"),
    at: tz("at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payout_approvals_admin_ux").on(t.payoutId, t.adminId),
    uniqueIndex("payout_approvals_step_ux").on(t.payoutId, t.step),
    check("payout_approvals_step_ck", raw("step in (1, 2)")),
    check("payout_approvals_note_len_ck", raw("note is null or length(note) <= 500")),
  ],
)

export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: text("id").primaryKey(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("open"),
    payoutCount: integer("payout_count").notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    ranBy: text("ran_by"),
    ranAt: tz("ran_at"),
    finishedAt: tz("finished_at"),
  },
  (t) => [index("payout_batches_created_ix").on(t.createdAt), oneOf("payout_batches_status_ck", "status", PAYOUT_BATCH_STATUSES)],
)

export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: text("id").primaryKey(),
    windowFrom: tz("window_from").notNull(),
    windowTo: tz("window_to").notNull(),
    status: text("status").notNull().default("running"),
    /** False when PAYMENTS exposes no provider events to compare against (internal checks only). */
    providerCompared: boolean("provider_compared").notNull().default(false),
    checked: integer("checked").notNull().default(0),
    mismatches: integer("mismatches").notNull().default(0),
    summary: jsonb("summary").$type<Record<string, number>>().notNull().default(raw("'{}'::jsonb")),
    triggeredBy: text("triggered_by").notNull().default("system"),
    startedAt: tz("started_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
  },
  (t) => [index("reconciliation_runs_started_ix").on(t.startedAt), oneOf("reconciliation_runs_status_ck", "status", RECON_RUN_STATUSES)],
)

export const reconciliationItems = pgTable(
  "reconciliation_items",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => reconciliationRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The id the mismatch is about: payment, refund, payout, transaction or account id. */
    ref: text("ref").notNull(),
    currency: text("currency"),
    ledgerMinor: bigint("ledger_minor", { mode: "number" }),
    providerMinor: bigint("provider_minor", { mode: "number" }),
    facts: jsonb("facts").$type<Record<string, string | number | boolean | null>>().notNull().default(raw("'{}'::jsonb")),
    status: text("status").notNull().default("open"),
    resolvedBy: text("resolved_by"),
    resolvedAt: tz("resolved_at"),
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    index("reconciliation_items_run_ix").on(t.runId),
    index("reconciliation_items_status_ix").on(t.status),
    oneOf("reconciliation_items_kind_ck", "kind", RECON_ITEM_KINDS),
    oneOf("reconciliation_items_status_ck", "status", ["open", "resolved"]),
    check("reconciliation_items_note_len_ck", raw("resolution_note is null or length(resolution_note) <= 500")),
  ],
)
