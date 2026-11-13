import { z } from "zod"
import { route } from "@/server/http/route"
import { listAdminUsers } from "@/server/admin/users-directory"

const query = z.object({ q: z.string().max(120).optional(), limit: z.coerce.number().int().min(1).max(500).optional() })

/** GET /api/admin/users[?q=]: the account directory (real accounts; demo ones only with sample data on). */
export const GET = route({ rate: { key: "admin.users", limit: 60, windowSec: 60 }, auth: "admin", permission: "abuse.view", query }, async ({ query }) => listAdminUsers(query))
