import { snapshot } from "@/server/monitoring/metrics"
import { route } from "@/server/http/route"

/** GET /api/admin/monitoring: live request, error, latency and host figures since the server started. */
export const GET = route({ rate: { key: "admin.monitoring.read", limit: 120, windowSec: 60 }, auth: "admin", permission: "audit.view", cache: "no-store" }, async () => snapshot())
