import { route } from "@/server/http/route"
import { queueCountsFor } from "@/server/moderation"

/** GET /api/admin/queues/counts: each count only when the admin's role may view that queue (§8.2). */
export const GET = route({ auth: "admin", permission: "any_admin" }, async ({ actor }) => queueCountsFor(actor))
