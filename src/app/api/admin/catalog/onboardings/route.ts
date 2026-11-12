import { z } from "zod"
import { listSubmittedOnboardings } from "@/server/catalog"
import { route } from "@/server/http/route"

/** GET /api/admin/catalog/onboardings?limit: the brand application review queue (submitted, oldest first). */
export const GET = route({ rate: { key: "admin.onboardings", limit: 120, windowSec: 60 }, auth: "admin", permission: "brands.restrict", query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) }, async ({ query }) =>
  listSubmittedOnboardings(query.limit),
)
