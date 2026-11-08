import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core"
import { brands } from "./brands"
import { oneOf, raw, tsvector, tz } from "./columns"
import { users } from "./people"

/**
 * ENGAGEMENT (v3): email outbox, notification preferences, drops and draws, back-in-stock and
 * price watches, and the search index. Follows, wishlist and drop reminders stay in the existing
 * shopper_follows / shopper_wishlist / shopper_reminders tables (charts.ts) so signals ingest keeps
 * working unchanged; these tables only add what those don't hold.
 *
 * Product and variant ids are not foreign keys: the catalogue tables belong to CATALOG and are
 * reached only through its contract functions.
 */

const EMAIL_STATUSES = ["pending", "sending", "sent", "failed", "suppressed", "stub"] as const
const EMAIL_CATEGORIES = ["account", "orders", "payouts", "drops", "price_drops", "back_in_stock", "brand_news"] as const
const SUPPRESSION_REASONS = ["unsubscribe", "bounce", "complaint", "manual"] as const
const DROP_ACCESS = ["first_come", "draw", "early_access"] as const
const DROP_STATUSES = ["draft", "scheduled", "live", "ended", "cancelled"] as const
const DROP_ENTRY_STATUSES = ["entered", "won", "waitlisted", "purchased", "expired", "lost", "withdrawn"] as const
const DROP_CLAIM_STATUSES = ["pending", "confirmed", "released"] as const

/* ---------- Email ---------- */

/**
 * One row per email to send. `dedupe_key` makes enqueueEmail idempotent (a retried caller never
 * sends twice). The delivery worker claims rows with `locked_until`, retries with backoff and
 * records the provider's message id. `stub` means no provider is configured: the email was NOT sent.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: text("id").primaryKey(),
    template: text("template").notNull(),
    category: text("category").notNull(),
    toEmail: text("to_email").notNull(),
    vars: jsonb("vars").$type<Record<string, string | number>>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: tz("next_attempt_at").notNull().defaultNow(),
    lockedUntil: tz("locked_until"),
    lastError: text("last_error"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
    sentAt: tz("sent_at"),
  },
  (t) => [
    uniqueIndex("email_outbox_dedupe_ux").on(t.dedupeKey),
    index("email_outbox_due_ix").on(t.status, t.nextAttemptAt),
    index("email_outbox_to_ix").on(raw("lower(to_email)"), t.createdAt.desc()),
    oneOf("email_outbox_status_ck", "status", EMAIL_STATUSES),
    oneOf("email_outbox_category_ck", "category", EMAIL_CATEGORIES),
    check("email_outbox_last_error_len_ck", raw("last_error is null or length(last_error) <= 500")),
  ],
)

/** Addresses that must not get a category of email (or 'all' optional email). Keyed by address so it works without an account. */
export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: text("id").primaryKey(),
    emailLower: text("email_lower").notNull(),
    /** An EMAIL_CATEGORIES value, or 'all' for every optional category. Transactional mail (account, orders, payouts) is only stopped by bounce/complaint. */
    category: text("category").notNull(),
    reason: text("reason").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_suppressions_email_category_ux").on(t.emailLower, t.category),
    oneOf("email_suppressions_reason_ck", "reason", SUPPRESSION_REASONS),
    check("email_suppressions_category_ck", raw(`category in ('all', ${EMAIL_CATEGORIES.map((c) => `'${c}'`).join(", ")})`)),
  ],
)

/** Per-user notification preferences. No row = defaults (everything on). */
export const notificationPreferences = pgTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailDrops: boolean("email_drops").notNull().default(true),
  emailPriceDrops: boolean("email_price_drops").notNull().default(true),
  emailBackInStock: boolean("email_back_in_stock").notNull().default(true),
  emailBrandNews: boolean("email_brand_news").notNull().default(true),
  inappDrops: boolean("inapp_drops").notNull().default(true),
  inappPriceDrops: boolean("inapp_price_drops").notNull().default(true),
  inappBackInStock: boolean("inapp_back_in_stock").notNull().default(true),
  inappBrandNews: boolean("inapp_brand_news").notNull().default(true),
  updatedAt: tz("updated_at").notNull().defaultNow(),
})

/* ---------- Drops ---------- */

/**
 * A drop with absolute UTC times. first_come: anyone may buy between starts_at and ends_at.
 * early_access: followers (who followed before early_access_at) may buy from early_access_at.
 * draw: shoppers enter between entry_opens_at and entry_closes_at; at draw_at the server draws
 * winners with a seed committed in advance (draw_seed_hash = sha256(draw_seed), the seed is revealed
 * after the draw); winners get a purchase window of purchase_window_minutes.
 */
export const drops = pgTable(
  "drops",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** A media id or a /media path. */
    image: text("image"),
    access: text("access").notNull(),
    status: text("status").notNull().default("draft"),
    startsAt: tz("starts_at").notNull(),
    endsAt: tz("ends_at").notNull(),
    earlyAccessAt: tz("early_access_at"),
    entryOpensAt: tz("entry_opens_at"),
    entryClosesAt: tz("entry_closes_at"),
    drawAt: tz("draw_at"),
    purchaseWindowMinutes: integer("purchase_window_minutes").notNull().default(1440),
    winnersCount: integer("winners_count"),
    limitPerCustomer: integer("limit_per_customer").notNull().default(1),
    totalUnits: integer("total_units").notNull().default(0),
    reminderLeadMinutes: integer("reminder_lead_minutes").notNull().default(60),
    reminderSentAt: tz("reminder_sent_at"),
    earlyAccessSentAt: tz("early_access_sent_at"),
    startedAt: tz("started_at"),
    endedAt: tz("ended_at"),
    drawSeedHash: text("draw_seed_hash"),
    /** Secret until drawn_at; revealed afterwards so anyone can re-run the selection. */
    drawSeed: text("draw_seed"),
    drawnAt: tz("drawn_at"),
    sponsored: boolean("sponsored").notNull().default(false),
    createdBy: text("created_by"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("drops_slug_ux").on(t.slug),
    index("drops_status_starts_ix").on(t.status, t.startsAt),
    index("drops_brand_starts_ix").on(t.brandId, t.startsAt.desc()),
    oneOf("drops_access_ck", "access", DROP_ACCESS),
    oneOf("drops_status_ck", "status", DROP_STATUSES),
    check("drops_window_ck", raw("ends_at > starts_at")),
    check("drops_limit_ck", raw("limit_per_customer between 1 and 20")),
    check("drops_units_ck", raw("total_units >= 0")),
    check("drops_purchase_window_ck", raw("purchase_window_minutes between 5 and 10080")),
    check("drops_reminder_lead_ck", raw("reminder_lead_minutes between 0 and 10080")),
    check("drops_name_len_ck", raw("length(name) between 1 and 120")),
    check("drops_description_len_ck", raw("length(description) <= 2000")),
  ],
)

/** The variants a drop sells (product ids kept for display and joins). */
export const dropItems = pgTable(
  "drop_items",
  {
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.dropId, t.variantId], name: "drop_items_pk" }), index("drop_items_variant_ix").on(t.variantId), index("drop_items_product_ix").on(t.productId)],
)

/** Draw entries; after the draw `rank` is the shopper's place in the seeded order. */
export const dropEntries = pgTable(
  "drop_entries",
  {
    id: text("id").primaryKey(),
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("entered"),
    rank: integer("rank"),
    windowOpensAt: tz("window_opens_at"),
    windowEndsAt: tz("window_ends_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    decidedAt: tz("decided_at"),
  },
  (t) => [
    uniqueIndex("drop_entries_drop_user_ux").on(t.dropId, t.userId),
    index("drop_entries_drop_status_ix").on(t.dropId, t.status, t.rank),
    index("drop_entries_user_ix").on(t.userId, t.createdAt.desc()),
    oneOf("drop_entries_status_ck", "status", DROP_ENTRY_STATUSES),
  ],
)

/**
 * Units a customer has claimed in a drop: pending while their checkout is open (expires_at),
 * confirmed once paid, released on failure. checkDropLimit counts pending + confirmed.
 */
export const dropClaims = pgTable(
  "drop_claims",
  {
    id: text("id").primaryKey(),
    dropId: text("drop_id")
      .notNull()
      .references(() => drops.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull(),
    qty: integer("qty").notNull(),
    checkoutId: text("checkout_id").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("drop_claims_checkout_variant_ux").on(t.checkoutId, t.dropId, t.variantId),
    index("drop_claims_drop_user_ix").on(t.dropId, t.userId, t.status),
    index("drop_claims_pending_ix").on(t.status, t.expiresAt),
    oneOf("drop_claims_status_ck", "status", DROP_CLAIM_STATUSES),
    check("drop_claims_qty_ck", raw("qty between 1 and 100")),
  ],
)

/* ---------- Watches ---------- */

/** A shopper asking to hear when a sold-out variant is back. */
export const backInStockRequests = pgTable(
  "back_in_stock_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    notifiedAt: tz("notified_at"),
  },
  (t) => [uniqueIndex("back_in_stock_user_variant_ux").on(t.userId, t.variantId), index("back_in_stock_pending_ix").on(t.variantId).where(raw("notified_at is null"))],
)

/** The last price/availability the watch job saw for a wishlisted product (price-drop and back-in-stock detection). */
export const productWatchState = pgTable("product_watch_state", {
  productId: text("product_id").primaryKey(),
  currency: text("currency").notNull(),
  minPriceMinor: integer("min_price_minor").notNull(),
  available: integer("available").notNull(),
  checkedAt: tz("checked_at").notNull().defaultNow(),
})

/* ---------- Search ---------- */

/**
 * The product search index, written only by reindexProduct(). `price_usd_minor` normalises prices
 * so filters and sorts work in any shopper currency; `visible` is false for unpublished or
 * moderation-hidden products (they stay indexed but never match).
 */
export const searchProducts = pgTable(
  "search_products",
  {
    productId: text("product_id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    brandName: text("brand_name").notNull(),
    slug: text("slug"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category"),
    subcategory: text("subcategory"),
    tagsText: text("tags_text").notNull().default(""),
    tags: text("tags").array().notNull().default(raw("'{}'::text[]")),
    priceMinor: integer("price_minor").notNull(),
    compareAtMinor: integer("compare_at_minor"),
    currency: text("currency").notNull(),
    priceUsdMinor: integer("price_usd_minor").notNull(),
    available: integer("available").notNull().default(0),
    variantIds: text("variant_ids").array().notNull().default(raw("'{}'::text[]")),
    image: text("image"),
    visible: boolean("visible").notNull().default(true),
    publishedAt: tz("published_at"),
    indexedAt: tz("indexed_at").notNull().defaultNow(),
    tsv: tsvector("tsv").generatedAlwaysAs(
      raw(
        "setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(brand_name, '')), 'A') || setweight(to_tsvector('simple', coalesce(category, '') || ' ' || coalesce(subcategory, '') || ' ' || coalesce(tags_text, '')), 'B') || setweight(to_tsvector('simple', coalesce(description, '')), 'C')",
      ),
    ),
  },
  (t) => [
    index("search_products_tsv_ix").using("gin", t.tsv),
    index("search_products_brand_ix").on(t.brandId),
    index("search_products_category_ix").on(t.category),
    index("search_products_price_ix").on(t.priceUsdMinor),
  ],
)

/** The brand search index (from the brands table plus the sample brand copy). */
export const searchBrands = pgTable(
  "search_brands",
  {
    brandId: text("brand_id")
      .primaryKey()
      .references(() => brands.id),
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    city: text("city").notNull(),
    country: text("country").notNull(),
    categoriesText: text("categories_text").notNull().default(""),
    tagline: text("tagline").notNull().default(""),
    visible: boolean("visible").notNull().default(true),
    indexedAt: tz("indexed_at").notNull().defaultNow(),
    tsv: tsvector("tsv").generatedAlwaysAs(
      raw(
        "setweight(to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(handle, '')), 'A') || setweight(to_tsvector('simple', coalesce(city, '') || ' ' || coalesce(categories_text, '')), 'B') || setweight(to_tsvector('simple', coalesce(tagline, '')), 'C')",
      ),
    ),
  },
  (t) => [index("search_brands_tsv_ix").using("gin", t.tsv)],
)
