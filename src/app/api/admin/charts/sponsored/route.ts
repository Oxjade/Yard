import { route } from "@/server/http/route"
import { sponsoredList } from "@/server/moderation"

/** GET /api/admin/charts/sponsored: sponsored placements, read-only and never ranked. */
export const GET = route({ rate: { key: "admin.charts.read", limit: 240, windowSec: 60 }, auth: "admin", permission: "sponsored.view" }, async () => sponsoredList())
