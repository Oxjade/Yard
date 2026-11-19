import { boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core"
import { IMPORT_ITEM_STATUSES, IMPORT_PLATFORMS, IMPORT_STATUSES, SITE_PIECE_SIDES, SITE_PIECE_STATUSES, WATCH_STATUSES } from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { catalogProducts, productProposals } from "./catalog"
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
    /**
     * Null while a "Create brand from website" scan has no brand yet (Admin › Brands › Founding,
     * src/server/catalog/from-website.ts): Create store creates the founding brand and sets it.
     */
    brandId: text("brand_id").references(() => brands.id),
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

/**
 * Watching a brand's website for new pieces (docs/IMPORTER.md › Watching a website). At most one
 * watched site per brand (the brand is the key). Off by default: a row exists once an admin turned
 * watching on, and `enabled` is the toggle. The scheduler (catalog.watchSites) re-scans due sites
 * (next_scan_at), a few brands per run; repeated failures back off and then pause the watch with
 * a note shown in Admin. lease_until keeps two runs (or Check now and the scheduler) apart.
 */
export const catalogWatches = pgTable(
  "catalog_watches",
  {
    brandId: text("brand_id")
      .primaryKey()
      .references(() => brands.id),
    /** The address watched, cleaned (a Labeld marketplace page is already the brand's own shop). */
    sourceUrl: text("source_url").notNull(),
    /** The adapter that read the site when watching started; a run only tries this one. */
    platform: text("platform").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("active"),
    /** Why the watch paused itself (shown in Admin). */
    pausedNote: text("paused_note"),
    /** Failed checks in a row (0 after a good one). */
    failures: integer("failures").notNull().default(0),
    lastError: text("last_error"),
    lastScanAt: tz("last_scan_at"),
    lastOkAt: tz("last_ok_at"),
    nextScanAt: tz("next_scan_at").notNull(),
    leaseUntil: tz("lease_until"),
    /** The last run's outcome: { new, changes, requests, products }. */
    lastRun: jsonb("last_run").$type<Record<string, unknown>>(),
    createdBy: text("created_by").references(() => users.id),
    createdByName: text("created_by_name"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("catalog_watches_due_ix").on(t.enabled, t.status, t.nextScanAt), oneOf("catalog_watches_status_ck", "status", WATCH_STATUSES), oneOf("catalog_watches_platform_ck", "platform", IMPORT_PLATFORMS)],
)

/**
 * Every product Yard has seen on a brand's own website, one row per source address (url_key: the
 * address without protocol, www, trailing slash; source_id matches too). This is the "seen" list
 * that keeps a piece the brand or Yard passed over from ever coming back, the "New from your
 * website" inbox (status waiting), and the baseline for "Changes on their site" (price and
 * availability as last accepted). A waiting piece is claimed by one side (status approving,
 * decided_kind, lease_until) before anything is created, so the first side to act wins.
 */
export const catalogSitePieces = pgTable(
  "catalog_site_pieces",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    urlKey: text("url_key").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceId: text("source_id"),
    title: text("title").notNull(),
    status: text("status").notNull(),
    /** "import" (recorded by an import) or "watch" (found by a watch run). */
    origin: text("origin").notNull(),
    /** Why it was passed over, or the last approval error. */
    reason: text("reason"),
    /** ImportProductDto as the site shows it now (waiting pieces are created from it). */
    product: jsonb("product").$type<Record<string, unknown>>(),
    /** Photos copied into Yard so far (an interrupted approval reuses them). */
    mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
    /** { priceMinor, currency, available } as last accepted, for change detection. */
    baseline: jsonb("baseline").$type<Record<string, unknown>>(),
    /** A change on the site since the baseline: { price?: { from, to, currency }, soldOut?: true, at }. Only flagged. */
    change: jsonb("change").$type<Record<string, unknown>>(),
    decidedKind: text("decided_kind"),
    decidedBy: text("decided_by").references(() => users.id),
    decidedByName: text("decided_by_name"),
    decidedAt: tz("decided_at"),
    leaseUntil: tz("lease_until"),
    proposalId: text("proposal_id").references(() => productProposals.id),
    productId: text("product_id").references(() => catalogProducts.id),
    /** The watch run that found it (the brand is told once per run). */
    runId: text("run_id"),
    firstSeenAt: tz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("catalog_site_pieces_url_ux").on(t.brandId, t.urlKey),
    index("catalog_site_pieces_status_ix").on(t.brandId, t.status),
    index("catalog_site_pieces_lease_ix").on(t.status, t.leaseUntil),
    oneOf("catalog_site_pieces_status_ck", "status", SITE_PIECE_STATUSES),
    oneOf("catalog_site_pieces_origin_ck", "origin", ["import", "watch"]),
    oneOf("catalog_site_pieces_decided_ck", "decided_kind", SITE_PIECE_SIDES),
  ],
)
