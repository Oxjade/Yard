import { foundingHandleQuery } from "@/lib/api/contracts/founding"
import { foundingHandleStatus } from "@/server/catalog/founding"
import { route } from "@/server/http/route"

/** GET /api/admin/founding-brands/handle?handle= (brands.founding): { handle, status, available, message } with the onboarding handle rules. */
export const GET = route({ auth: "admin", permission: "brands.founding", query: foundingHandleQuery, rate: { key: "admin.founding.handle", limit: 120, windowSec: 60 } }, async ({ query }) => foundingHandleStatus(query.handle))
