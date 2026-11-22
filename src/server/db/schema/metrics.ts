import { bigint, index, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { oneOf, raw, tz } from "./columns"

/**
 * Persisted request activity for Admin › Health (src/server/monitoring/minutes.ts, store.ts).
 * Requests are counted in memory and written once a minute: one row per (minute, area) that saw
 * traffic, so the write rate depends on time, never on traffic. The same table holds the rollups:
 *
 *  - grain 'm': one row per minute, per area, per server process (`source` is the process's boot
 *    id). A flush writes the minute's running totals and replaces the row, so a retried or
 *    repeated flush never counts a request twice. Kept 48 hours.
 *  - grain 'h': one row per hour and area (`source` 'rollup'), made from the minute rows older
 *    than 48 hours by the nightly job. Kept 30 days.
 *  - grain 'd': one row per UTC day and area, made from the hourly rows older than 30 days. Kept 400 days.
 *
 * `area` is public, studio, admin or api (route class, minutes.ts areaOf), or 'events' for the
 * counters that are not requests (failed sign-ins, failed MFA codes, searches, proxy refusals),
 * which live in `events` as { name: count }. `hist` counts requests per latency bucket
 * (HIST_BOUNDS in minutes.ts), from which p50 and p95 are read for any span.
 */
export const metricsMinutes = pgTable(
  "metrics_minutes",
  {
    grain: text("grain").notNull(),
    at: tz("at").notNull(),
    area: text("area").notNull(),
    source: text("source").notNull(),
    requests: integer("requests").notNull().default(0),
    c4xx: integer("c4xx").notNull().default(0),
    c5xx: integer("c5xx").notNull().default(0),
    totalMs: bigint("total_ms", { mode: "number" }).notNull().default(0),
    maxMs: integer("max_ms").notNull().default(0),
    hist: integer("hist").array().notNull().default(raw("'{}'::integer[]")),
    events: jsonb("events").$type<Record<string, number>>().notNull().default(raw("'{}'::jsonb")),
  },
  (t) => [
    primaryKey({ columns: [t.grain, t.at, t.area, t.source], name: "metrics_minutes_pk" }),
    oneOf("metrics_minutes_grain_ck", "grain", ["m", "h", "d"]),
    oneOf("metrics_minutes_area_ck", "area", ["public", "studio", "admin", "api", "events"]),
  ],
)

/**
 * The builds this deployment has run (Admin › Health › Deploys). One row per build, written once
 * per server boot: `id` is YARD_DEPLOYMENT_ID (the commit yard-update builds with), else the git
 * commit, else Next's build id. `boots` counts the processes that started on it.
 */
export const deploys = pgTable(
  "deploys",
  {
    id: text("id").primaryKey(),
    version: text("version").notNull(),
    gitSha: text("git_sha"),
    buildId: text("build_id"),
    firstSeenAt: tz("first_seen_at").notNull().defaultNow(),
    lastBootAt: tz("last_boot_at").notNull().defaultNow(),
    boots: integer("boots").notNull().default(1),
  },
  (t) => [index("deploys_first_seen_ix").on(t.firstSeenAt.desc())],
)
