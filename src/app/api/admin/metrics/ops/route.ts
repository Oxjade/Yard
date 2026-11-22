import { route } from "@/server/http/route"
import { operations } from "@/server/monitoring/service"

/** GET /api/admin/metrics/ops: queue depths, storage, auth failures (24 h) and the deploy history, for Health. */
export const GET = route({ rate: { key: "admin.metrics.ops", limit: 60, windowSec: 60 }, auth: "admin", permission: "audit.view", cache: "no-store" }, async () => operations())
