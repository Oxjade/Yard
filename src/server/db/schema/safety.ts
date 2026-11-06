import { check, index, integer, jsonb, pgTable, smallint, text, uniqueIndex } from "drizzle-orm/pg-core"
import {
  ABUSE_ACTOR_KINDS,
  ABUSE_ALERT_KINDS,
  ABUSE_ALERT_STATUSES,
  ABUSE_RULES,
  ABUSE_SUBJECT_KINDS,
  REPORT_STATUSES,
  REPORT_SUBJECTS,
  REPORTER_KINDS,
  RESTRICTION_KINDS,
  RESTRICTION_STATUSES,
} from "../../../lib/api/contracts/enums"
import { brands } from "./brands"
import { oneOf, raw, tz } from "./columns"
import { users } from "./people"

/** Reports with frozen, bounded evidence (§3.4, §5.3). */
export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    brandId: text("brand_id").references(() => brands.id),
    reporterKind: text("reporter_kind").notNull(),
    reporterId: text("reporter_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    snapshot: jsonb("snapshot").notNull(),
    status: text("status").notNull().default("open"),
    priority: smallint("priority").notNull().default(2),
    assignedTo: text("assigned_to").references(() => users.id),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: tz("decided_at"),
    decision: text("decision"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("reports_queue_ix").on(t.status, t.subjectType, t.createdAt.desc()),
    index("reports_subject_ix").on(t.subjectType, t.subjectId),
    uniqueIndex("reports_one_open_ux").on(t.reporterKind, t.reporterId, t.subjectType, t.subjectId).where(raw("status in ('open', 'in_review')")),
    oneOf("reports_subject_type_ck", "subject_type", REPORT_SUBJECTS),
    oneOf("reports_reporter_kind_ck", "reporter_kind", REPORTER_KINDS),
    oneOf("reports_status_ck", "status", REPORT_STATUSES),
    check("reports_details_len_ck", raw("details is null or length(details) <= 1000")),
  ],
)

/** Rate-limit hits, spam rules and signal exclusions. `detail` holds counts and ids, never message text. */
export const abuseEvents = pgTable(
  "abuse_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    actorKind: text("actor_kind").notNull(),
    actorId: text("actor_id"),
    ipHash: text("ip_hash"),
    action: text("action").notNull(),
    rule: text("rule").notNull(),
    detail: jsonb("detail").notNull().default(raw("'{}'::jsonb")),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("abuse_events_actor_ix").on(t.actorKind, t.actorId, t.createdAt.desc()),
    index("abuse_events_rule_ix").on(t.rule, t.createdAt.desc()),
    oneOf("abuse_events_actor_kind_ck", "actor_kind", ABUSE_ACTOR_KINDS),
    oneOf("abuse_events_rule_ck", "rule", ABUSE_RULES),
  ],
)

export const abuseAlerts = pgTable(
  "abuse_alerts",
  {
    id: text("id").primaryKey(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("open"),
    evidence: jsonb("evidence").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    decidedBy: text("decided_by").references(() => users.id),
    decidedAt: tz("decided_at"),
    decisionReason: text("decision_reason"),
  },
  (t) => [
    uniqueIndex("abuse_alerts_open_ux").on(t.subjectKind, t.subjectId, t.kind).where(raw("status = 'open'")),
    index("abuse_alerts_status_ix").on(t.status, t.createdAt.desc()),
    oneOf("abuse_alerts_subject_kind_ck", "subject_kind", ABUSE_SUBJECT_KINDS),
    oneOf("abuse_alerts_kind_ck", "kind", ABUSE_ALERT_KINDS),
    oneOf("abuse_alerts_status_ck", "status", ABUSE_ALERT_STATUSES),
  ],
)

export const accountRestrictions = pgTable(
  "account_restrictions",
  {
    id: text("id").primaryKey(),
    subjectKind: text("subject_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    kind: text("kind").notNull(),
    until: tz("until"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => users.id),
    approvedBy: text("approved_by").references(() => users.id),
    createdAt: tz("created_at").notNull().defaultNow(),
    liftedAt: tz("lifted_at"),
    liftedBy: text("lifted_by"),
  },
  (t) => [
    index("account_restrictions_active_ix").on(t.subjectKind, t.subjectId).where(raw("status = 'active'")),
    oneOf("account_restrictions_subject_kind_ck", "subject_kind", ABUSE_SUBJECT_KINDS),
    oneOf("account_restrictions_kind_ck", "kind", RESTRICTION_KINDS),
    oneOf("account_restrictions_status_ck", "status", RESTRICTION_STATUSES),
  ],
)

/** Durable daily caps only; per-minute windows live in memory (§5.1). */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: tz("expires_at").notNull(),
})
