import { z } from "zod"
import { route } from "@/server/http/route"
import { HEATMAP_METRICS, heatmap } from "@/server/monitoring/service"

const query = z.object({ metric: z.enum(HEATMAP_METRICS).default("activity") })

/**
 * GET /api/admin/metrics/heatmap?metric=activity|orders|requests: daily totals for the last 53
 * weeks, by UTC day, for the year heatmap on Health and the Overview. "activity" sums orders
 * placed, shopper sign-ups, brand applications, products published and messages sent.
 */
export const GET = route({ rate: { key: "admin.metrics.heatmap", limit: 60, windowSec: 60 }, auth: "admin", permission: "audit.view", query, cache: "no-store" }, async ({ query }) => heatmap(query.metric))
