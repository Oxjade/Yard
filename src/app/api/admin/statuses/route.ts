import { z } from "zod"
import { route } from "@/server/http/route"
import { statusesFor } from "@/server/moderation"

const query = z.object({ kind: z.enum(["user", "brand"]), ids: z.string().max(4000) })

/**
 * GET /api/admin/statuses?kind=user|brand&ids=a,b: the server's account and brand statuses, so the
 * Users and Brands pages can mirror them into this browser's store (§1.11). Any admin may read.
 */
export const GET = route({ auth: "admin", permission: "any_admin", query }, async ({ query }) => ({
  statuses: await statusesFor(query.kind, query.ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 300)),
}))
