import { route } from "@/server/http/route"
import { sponsoredList } from "@/server/moderation"

/** GET /api/admin/charts/sponsored: sponsored placements, read-only and never ranked. */
export const GET = route({ auth: "admin", permission: "sponsored.view" }, async () => sponsoredList())
