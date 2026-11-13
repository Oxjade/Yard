import { z } from "zod"
import { geoReady } from "@/server/geo/country"
import { route } from "@/server/http/route"
import { trafficReport } from "@/server/traffic"

const query = z.object({ days: z.coerce.number().int().refine((n) => [1, 7, 30, 90].includes(n)).optional() })

/** GET /api/admin/traffic?days=1|7|30|90: marketplace page views and visitors by country. */
export const GET = route({ rate: { key: "admin.traffic", limit: 120, windowSec: 60 }, auth: "admin", permission: "audit.view", query, cache: "no-store" }, async ({ query }) => {
  const [report, geo] = await Promise.all([trafficReport(query.days ?? 7), geoReady()])
  return { ...report, geoReady: geo }
})
