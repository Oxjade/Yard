import { bigint, check, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { mediaAssets } from "./media"
import { users } from "./people"

/**
 * CATALOG (backend v3). Products, variants, options, images, collections and categories; stock as
 * a cached on-hand count with an append-only movement log plus TTL holds; storefront drafts and
 * published versions; brand onboarding. Money is integer minor units + ISO currency.
 *
 * Plain Node (no server-only, no @/ aliases): drizzle-kit loads this file outside Next.
 */

export const PRODUCT_STATUSES = ["draft", "scheduled", "published", "archived"] as const
export const PRODUCT_MODERATION = ["ok", "hidden"] as const
export const VARIANT_STATUSES = ["active", "archived"] as const
export const COLLECTION_STATUSES = ["draft", "published"] as const
export const STOCK_REASONS = ["seed", "adjustment", "set", "sale", "restock", "return", "correction"] as const
export const HOLD_STATUSES = ["active", "committed", "released", "expired"] as const
export const ONBOARDING_STATUSES = ["draft", "submitted", "approved", "rejected"] as const
export const ONBOARDING_STEPS = ["account", "brand", "storefront", "business", "product", "payments"] as const

/** The marketplace categories (seeded from src/lib/data/catalog.ts). Products link by slug. */
export const catalogCategories = pgTable("catalog_categories", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imagePath: text("image_path"),
  subcategories: text("subcategories").array().notNull().default([]),
  position: integer("position").notNull().default(0),
})

export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    details: text("details").array().notNull().default([]),
    categorySlug: text("category_slug")
      .notNull()
      .references(() => catalogCategories.slug),
    subcategory: text("subcategory"),
    tags: text("tags").array().notNull().default([]),
    badges: text("badges").array().notNull().default([]),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    compareAtMinor: bigint("compare_at_minor", { mode: "number" }),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("draft"),
    /** When a scheduled product goes live (the publishScheduled job flips it). */
    publishAt: tz("publish_at"),
    publishedAt: tz("published_at"),
    processingMin: integer("processing_min"),
    processingMax: integer("processing_max"),
    /** ENGAGEMENT's drop id (not a foreign key: drops live in another area). */
    dropId: text("drop_id"),
    /** Admin moderation: hidden products never appear in public reads or sellable lookups. */
    moderationStatus: text("moderation_status").notNull().default("ok"),
    moderationReason: text("moderation_reason"),
    moderatedAt: tz("moderated_at"),
    moderatedBy: text("moderated_by").references(() => users.id),
    /** Optimistic concurrency: every write bumps it; writers send the version they edited. */
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id),
    updatedBy: text("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("catalog_products_slug_ux").on(t.slug),
    index("catalog_products_brand_status_ix").on(t.brandId, t.status),
    index("catalog_products_public_ix").on(t.status, t.moderationStatus, t.createdAt),
    index("catalog_products_category_ix").on(t.categorySlug),
    index("catalog_products_scheduled_ix").on(t.publishAt).where(raw("status = 'scheduled'")),
    oneOf("catalog_products_status_ck", "status", PRODUCT_STATUSES),
    oneOf("catalog_products_moderation_ck", "moderation_status", PRODUCT_MODERATION),
    check("catalog_products_price_ck", raw("price_minor > 0 and (compare_at_minor is null or compare_at_minor > 0)")),
    check("catalog_products_processing_ck", raw("(processing_min is null and processing_max is null) or (processing_min >= 0 and processing_max >= processing_min)")),
  ],
)

/** Option axes, e.g. Size [S, M, L] or Colour [{ value: "Black", hex: "#111" }]. */
export const catalogOptions = pgTable(
  "catalog_product_options",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => catalogProducts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    values: jsonb("values").$type<{ value: string; hex?: string }[]>().notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("catalog_product_options_name_ux").on(t.productId, t.name)],
)

/**
 * Variants carry the stock counters. on_hand is the sellable physical count (changed only together
 * with a stock_movements row); held is the sum of active holds. available = on_hand - held.
 */
export const catalogVariants = pgTable(
  "catalog_variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => catalogProducts.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    sku: text("sku").notNull(),
    options: jsonb("options").$type<Record<string, string>>().notNull().default({}),
    /** Overrides the product price when set. */
    priceMinor: bigint("price_minor", { mode: "number" }),
    status: text("status").notNull().default("active"),
    position: integer("position").notNull().default(0),
    onHand: integer("on_hand").notNull().default(0),
    held: integer("held").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("catalog_variants_product_ix").on(t.productId),
    uniqueIndex("catalog_variants_brand_sku_ux").on(t.brandId, t.sku),
    oneOf("catalog_variants_status_ck", "status", VARIANT_STATUSES),
    check("catalog_variants_stock_ck", raw("on_hand >= 0 and held >= 0 and held <= on_hand")),
    check("catalog_variants_price_ck", raw("price_minor is null or price_minor > 0")),
  ],
)

/** Product photos: an uploaded brand media file (media_id) or a sample /media/… path. */
export const catalogImages = pgTable(
  "catalog_product_images",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => catalogProducts.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    mediaId: text("media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    path: text("path"),
    alt: text("alt").notNull().default(""),
    width: integer("width"),
    height: integer("height"),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("catalog_product_images_product_ix").on(t.productId, t.position), index("catalog_product_images_media_ix").on(t.mediaId), check("catalog_product_images_src_ck", raw("media_id is not null or path is not null"))],
)

export const catalogCollections = pgTable(
  "catalog_collections",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    imageMediaId: text("image_media_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    imagePath: text("image_path"),
    status: text("status").notNull().default("published"),
    position: integer("position").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("catalog_collections_brand_handle_ux").on(t.brandId, t.handle), oneOf("catalog_collections_status_ck", "status", COLLECTION_STATUSES)],
)

export const catalogCollectionProducts = pgTable(
  "catalog_collection_products",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => catalogCollections.id, { onDelete: "cascade" }),
    productId: text("product_id")
      .notNull()
      .references(() => catalogProducts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.productId] }), index("catalog_collection_products_product_ix").on(t.productId)],
)

/** Append-only: rows are inserted, never updated or deleted. on_hand_after is the variant's count after the move. */
export const stockMovements = pgTable(
  "catalog_stock_movements",
  {
    id: text("id").primaryKey(),
    variantId: text("variant_id")
      .notNull()
      .references(() => catalogVariants.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    delta: integer("delta").notNull(),
    onHandAfter: integer("on_hand_after").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    actorKind: text("actor_kind").notNull().default("system"),
    actorId: text("actor_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("catalog_stock_movements_variant_ix").on(t.variantId, t.createdAt), index("catalog_stock_movements_ref_ix").on(t.refType, t.refId), oneOf("catalog_stock_movements_reason_ck", "reason", STOCK_REASONS)],
)

/** Checkout holds: one row per (hold key, variant). Expired holds are swept back into available stock. */
export const stockHolds = pgTable(
  "catalog_stock_holds",
  {
    id: text("id").primaryKey(),
    holdKey: text("hold_key").notNull(),
    variantId: text("variant_id")
      .notNull()
      .references(() => catalogVariants.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    settledAt: tz("settled_at"),
  },
  (t) => [
    uniqueIndex("catalog_stock_holds_key_variant_ux").on(t.holdKey, t.variantId),
    index("catalog_stock_holds_active_ix").on(t.expiresAt).where(raw("status = 'active'")),
    oneOf("catalog_stock_holds_status_ck", "status", HOLD_STATUSES),
    check("catalog_stock_holds_qty_ck", raw("qty > 0")),
  ],
)

/** One working draft per brand. `revision` bumps on every save (conflict check); `base_version` is the published version it started from. */
export const storefrontDrafts = pgTable("catalog_storefront_drafts", {
  brandId: text("brand_id")
    .primaryKey()
    .references(() => brands.id),
  config: jsonb("config").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull().default(1),
  baseVersion: integer("base_version").notNull().default(0),
  updatedAt: tz("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by").references(() => users.id),
})

/** Published storefronts, immutable. The highest version is live. */
export const storefrontVersions = pgTable(
  "catalog_storefront_versions",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    version: integer("version").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    note: text("note"),
    publishedAt: tz("published_at").notNull().defaultNow(),
    publishedBy: text("published_by").references(() => users.id),
  },
  (t) => [uniqueIndex("catalog_storefront_versions_brand_version_ux").on(t.brandId, t.version)],
)

/** A shopper's brand application, saved step by step. On submit it creates the brand (pending_review). */
export const brandOnboardings = pgTable(
  "catalog_brand_onboardings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("draft"),
    currentStep: text("current_step").notNull().default("account"),
    completedSteps: text("completed_steps").array().notNull().default([]),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    revision: integer("revision").notNull().default(1),
    brandId: text("brand_id").references(() => brands.id),
    submittedAt: tz("submitted_at"),
    reviewedAt: tz("reviewed_at"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewNote: text("review_note"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("catalog_brand_onboardings_open_ux").on(t.userId).where(raw("status in ('draft', 'submitted')")),
    index("catalog_brand_onboardings_status_ix").on(t.status, t.submittedAt),
    oneOf("catalog_brand_onboardings_status_ck", "status", ONBOARDING_STATUSES),
  ],
)
