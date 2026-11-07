import { z } from "zod"
import { route } from "@/server/http/route"
import { reinstateTargets, statusesFor } from "@/server/moderation"

const query = z.object({ kind: z.enum(["user", "brand"]), ids: z.string().max(4000) })

/**
 * GET /api/admin/statuses?kind=user|brand&ids=a,b: the server's account and brand statuses, so the
 * Users and Brands pages can mirror them into this browser's store (§1.11), and for brands the
 * status Reinstate would restore (`reinstateTo`). Any admin may read.
 */
export const GET = route({ auth: "admin", permission: "any_admin", query }, async ({ query }) => {
  const ids = query.ids.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 300)
  // For brands, also what Reinstate would restore for each restricted or suspended one.
  return query.kind === "brand" ? { statuses: await statusesFor("brand", ids), reinstateTo: await reinstateTargets(ids) } : { statuses: await statusesFor("user", ids) }
})
