import { z } from "zod"
import { route } from "@/server/http/route"
import { METRICS, RANGE_KEYS } from "@/server/monitoring/series"
import { metricSeries } from "@/server/monitoring/service"

const query = z.object({
  range: z.enum(RANGE_KEYS as [string, ...string[]]).default("24h"),
  metric: z.enum(METRICS).default("requests"),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
})

/**
 * GET /api/admin/metrics?range=1h|24h|7d|30d|1y&metric=requests|errors|latency|orders|revenue|signups[&currency=NGN]:
 * the Health page's Activity graph. Requests, errors and latency come from metrics_minutes (written
 * once a minute); orders, revenue and sign-ups from the order, account and application tables.
 * Buckets are UTC. Same permission as live monitoring.
 */
export const GET = route({ rate: { key: "admin.metrics", limit: 120, windowSec: 60 }, auth: "admin", permission: "audit.view", query, cache: "no-store" }, async ({ query }) =>
  metricSeries(query.range as (typeof RANGE_KEYS)[number], query.metric, query.currency ?? null),
)
