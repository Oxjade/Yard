import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core"
import { AUDIT_ACTOR_KINDS, RECIPIENT_KINDS } from "../../../lib/api/contracts/enums"
import { oneOf, raw, tz } from "./columns"

/** Server audit rows (§3.8, §8.3). `meta` never holds tokens, message bodies or coordinates. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: tz("at").notNull().defaultNow(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    role: text("role"),
    action: text("action").notNull(),
    target: text("target"),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    brandId: text("brand_id"),
    reason: text("reason"),
    approvedBy: text("approved_by"),
    ipHash: text("ip_hash"),
    meta: jsonb("meta").notNull().default(raw("'{}'::jsonb")),
  },
  (t) => [
    index("audit_log_at_ix").on(t.at.desc()),
    index("audit_log_subject_ix").on(t.subjectType, t.subjectId),
    index("audit_log_actor_ix").on(t.actorId, t.at.desc()),
    index("audit_log_brand_ix").on(t.brandId, t.at.desc()),
    oneOf("audit_log_actor_kind_ck", "actor_kind", AUDIT_ACTOR_KINDS),
  ],
)

/** Server notifications; title and body come only from templates (§2.7). */
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientKind: text("recipient_kind").notNull(),
    recipientId: text("recipient_id").notNull(),
    eventKey: text("event_key").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    createdAt: tz("created_at").notNull().defaultNow(),
    readAt: tz("read_at"),
  },
  (t) => [
    uniqueIndex("notifications_recipient_key_ux").on(t.recipientKind, t.recipientId, t.eventKey),
    index("notifications_recipient_ix").on(t.recipientKind, t.recipientId, t.createdAt.desc()),
    oneOf("notifications_recipient_kind_ck", "recipient_kind", RECIPIENT_KINDS),
  ],
)

/** The 24-hour event log for SSE replay. `payload` is the redacted durable form (§4.1). */
export const realtimeEvents = pgTable(
  "realtime_events",
  {
    seq: integer("seq").primaryKey().generatedAlwaysAsIdentity(),
    channel: text("channel").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("realtime_events_channel_seq_ix").on(t.channel, t.seq), index("realtime_events_created_ix").on(t.createdAt)],
)

/**
 * Site visits per UTC day and visitor country (admin Traffic). Only counts: no IPs, no visitor ids.
 * `country` is ISO 3166-1 alpha-2, or "ZZ" when the country is unknown.
 */
export const trafficDaily = pgTable(
  "traffic_daily",
  {
    day: text("day").notNull(),
    country: text("country").notNull(),
    views: integer("views").notNull().default(0),
    visitors: integer("visitors").notNull().default(0),
  },
  (t) => [uniqueIndex("traffic_daily_day_country_ux").on(t.day, t.country), index("traffic_daily_day_ix").on(t.day)],
)
