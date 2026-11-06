import { date, index, integer, jsonb, pgTable, primaryKey, real, text, uniqueIndex } from "drizzle-orm/pg-core"
import {
  CHART_DETECTORS,
  CHART_EVENT_KINDS,
  CHART_KINDS,
  CHART_MOVEMENTS,
  CHART_PERIODS,
  CHART_SUBJECT_TYPES,
  EDITION_STATUSES,
  FLAG_AUTO_ACTIONS,
  FLAG_STATUSES,
  SEVERITIES,
  SIGNAL_ACTOR_KINDS,
  SIGNAL_VERDICTS,
} from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { users } from "./people"

/** Server-side follow, wishlist and reminder state, written only by signal ingest (§3.5, §6.3). */
export const shopperFollows = pgTable(
  "shopper_follows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.brandId], name: "shopper_follows_pk" })],
)

export const shopperWishlist = pgTable(
  "shopper_wishlist",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId], name: "shopper_wishlist_pk" })],
)

export const shopperReminders = pgTable(
  "shopper_reminders",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dropId: text("drop_id").notNull(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.dropId], name: "shopper_reminders_pk" })],
)

export const chartFlags = pgTable(
  "chart_flags",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    detector: text("detector").notNull(),
    severity: text("severity").notNull(),
    windowStart: date("window_start", { mode: "string" }).notNull(),
    windowEnd: date("window_end", { mode: "string" }).notNull(),
    evidence: jsonb("evidence").notNull(),
    excludedEvents: integer("excluded_events").notNull().default(0),
    autoAction: text("auto_action").notNull().default("none"),
    status: text("status").notNull().default("open"),
    decidedBy: text("decided_by"),
    decidedAt: tz("decided_at"),
    decisionReason: text("decision_reason"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chart_flags_window_ux").on(t.brandId, t.detector, t.windowStart),
    index("chart_flags_status_ix").on(t.status, t.severity),
    oneOf("chart_flags_detector_ck", "detector", CHART_DETECTORS),
    oneOf("chart_flags_severity_ck", "severity", SEVERITIES),
    oneOf("chart_flags_auto_action_ck", "auto_action", FLAG_AUTO_ACTIONS),
    oneOf("chart_flags_status_ck", "status", FLAG_STATUSES),
  ],
)

/** Chart signals (§3.5). Views and opens count once per actor, item, kind and day. */
export const chartEvents = pgTable(
  "chart_events",
  {
    seq: integer("seq").primaryKey().generatedAlwaysAsIdentity(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    productId: text("product_id"),
    dropId: text("drop_id"),
    kind: text("kind").notNull(),
    actorKind: text("actor_kind").notNull(),
    /** users.id, or 'anon_' + HMAC(keys.anon, cookie id).slice(0, 20). */
    actorId: text("actor_id").notNull(),
    accountAgeDays: integer("account_age_days"),
    ipHash: text("ip_hash"),
    uaHash: text("ua_hash"),
    day: date("day", { mode: "string" }).notNull(),
    valueMinor: integer("value_minor"),
    verdict: text("verdict").notNull().default("counted"),
    flagId: text("flag_id").references(() => chartFlags.id),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("chart_events_brand_day_ix").on(t.brandId, t.day),
    index("chart_events_day_kind_ix").on(t.day, t.kind),
    index("chart_events_ip_day_ix").on(t.ipHash, t.day).where(raw("ip_hash is not null")),
    index("chart_events_actor_kind_day_ix").on(t.actorId, t.kind, t.day),
    uniqueIndex("chart_events_view_once_ux")
      .on(t.kind, t.brandId, raw("coalesce(product_id, '')"), raw("coalesce(drop_id, '')"), t.actorId, t.day)
      .where(raw("verdict = 'counted' and kind in ('product_view', 'storefront_view', 'post_open')")),
    oneOf("chart_events_kind_ck", "kind", CHART_EVENT_KINDS),
    oneOf("chart_events_actor_kind_ck", "actor_kind", SIGNAL_ACTOR_KINDS),
    oneOf("chart_events_verdict_ck", "verdict", SIGNAL_VERDICTS),
  ],
)

export const chartSnapshots = pgTable(
  "chart_snapshots",
  {
    id: text("id").primaryKey(),
    chart: text("chart").notNull(),
    period: text("period").notNull(),
    /** 'global' | 'city:<slug>' | 'country:<CC>' | 'category:<slug>' | 'city:<slug>|category:<slug>' */
    scope: text("scope").notNull(),
    edition: date("edition", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    cohortSize: integer("cohort_size").notNull(),
    computedAt: tz("computed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chart_snapshots_edition_ux").on(t.chart, t.period, t.scope, t.edition),
    index("chart_snapshots_lookup_ix").on(t.chart, t.period, t.scope, t.edition.desc()),
    oneOf("chart_snapshots_chart_ck", "chart", CHART_KINDS),
    oneOf("chart_snapshots_period_ck", "period", CHART_PERIODS),
    oneOf("chart_snapshots_status_ck", "status", EDITION_STATUSES),
  ],
)

export const chartEntries = pgTable(
  "chart_entries",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => chartSnapshots.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id),
    score: real("score").notNull(),
    prevRank: integer("prev_rank"),
    peakRank: integer("peak_rank").notNull(),
    editionsOnChart: integer("editions_on_chart").notNull(),
    movement: text("movement").notNull(),
    delta: integer("delta").notNull().default(0),
    /** Public-safe display stats only (§6.3). */
    stats: jsonb("stats").notNull(),
    /** Normalised signal components; read only by Admin. */
    components: jsonb("components").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.rank], name: "chart_entries_pk" }),
    index("chart_entries_subject_ix").on(t.subjectId),
    index("chart_entries_brand_ix").on(t.brandId),
    oneOf("chart_entries_subject_type_ck", "subject_type", CHART_SUBJECT_TYPES),
    oneOf("chart_entries_movement_ck", "movement", CHART_MOVEMENTS),
  ],
)
