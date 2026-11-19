import { index, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { IMPORT_ITEM_STATUSES, IMPORT_PLATFORMS, IMPORT_STATUSES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { productProposals } from "./catalog"
import { oneOf, tz } from "./columns"
import { users } from "./people"

/**
 * Import from website (docs/IMPORTER.md, src/server/catalog/importer). One row per scan an admin
 * starts for a brand, with the brand's recorded consent. The background runner claims a row with
 * a lease (lease_until), so a restart or a second process picks up where it stopped: a scan starts
 * over, an import carries on with the items still queued.
 */
export const catalogImports = pgTable(
  "catalog_imports",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    /** The address as the admin pasted it, tracking parameters removed. */
    sourceUrl: text("source_url").notNull(),
    /** Where the scan started (a Labeld marketplace page becomes the brand's own shop). */
    startUrl: text("start_url"),
    platform: text("platform"),
    status: text("status").notNull().default("scanning"),
    /** "This brand agreed to us importing their products", ticked by created_by. */
    consentAt: tz("consent_at").notNull(),
    progress: jsonb("progress").$type<Record<string, unknown>>().notNull().default({}),
    /** ImportBrandDto: name, logo, banner, description, socials as the site states them. */
    brand: jsonb("brand").$type<Record<string, unknown>>(),
    /** ImportProductDto[]: what the scan found, normalised, with warnings and duplicate flags. */
    found: jsonb("found").$type<Record<string, unknown>[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    error: text("error"),
    /** The storefront choices (logo, banner, description, socials) and whether they were applied. */
    profile: jsonb("profile").$type<Record<string, unknown>>(),
    note: text("note"),
    leaseUntil: tz("lease_until"),
    attempts: integer("attempts").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdByName: text("created_by_name"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
  },
  (t) => [
    index("catalog_imports_brand_ix").on(t.brandId, t.createdAt.desc()),
    index("catalog_imports_status_ix").on(t.status, t.leaseUntil),
    oneOf("catalog_imports_status_ck", "status", IMPORT_STATUSES),
    oneOf("catalog_imports_platform_ck", "platform", IMPORT_PLATFORMS),
  ],
)

/**
 * One ticked (or skipped) product of an import. The admin's edited choice is stored, so the
 * runner can resume after a restart; media_ids grows as photos are copied into Yard, so a resumed
 * item never downloads a photo twice. source_url is how a later scan knows it was imported before.
 */
export const catalogImportItems = pgTable(
  "catalog_import_items",
  {
    importId: text("import_id")
      .notNull()
      .references(() => catalogImports.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    choice: jsonb("choice").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("queued"),
    reason: text("reason"),
    proposalId: text("proposal_id").references(() => productProposals.id),
    mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
    imagesTotal: integer("images_total").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    position: integer("position").notNull().default(0),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.importId, t.key] }), index("catalog_import_items_source_ix").on(t.brandId, t.sourceUrl), oneOf("catalog_import_items_status_ck", "status", IMPORT_ITEM_STATUSES)],
)
