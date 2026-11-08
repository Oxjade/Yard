import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { getEnv } from "@/server/env"
import { forbidden } from "@/server/http/errors"
import { json, route } from "@/server/http/route"
import { devCleanupM } from "@/server/moderation/dev-cleanup"

/**
 * POST /api/admin/dev/cleanup { auditIds?, deletedPlaceIds?, deletedEventIds?, dryRun? } — development only (404 in production before
 * auth) and the owner role only. M's curl kit, project check and browser scripts call it last with
 * the audit ids their own decisions returned, so the demo people see exactly the seeded sample data
 * afterwards. Nothing is selected by time; what it removes is listed on devCleanupM.
 */
const body = z.strictObject({
  auditIds: z.array(z.string().min(1).max(80)).max(500).optional(),
  deletedPlaceIds: z.array(z.string().regex(/^loc_[A-Za-z0-9_-]{1,60}$/)).max(50).optional(),
  deletedEventIds: z.array(z.string().regex(/^lev_[A-Za-z0-9_-]{1,60}$/)).max(50).optional(),
  dryRun: z.boolean().optional(),
})

const post = route({ auth: "admin", permission: "any_admin", body, rate: { key: "admin.dev.cleanup", limit: 20, windowSec: 60 } }, async ({ actor, body, ipHash }) => {
  if (actor.role !== "owner") throw forbidden("Needs the Owner role.")
  return json(await devCleanupM(actor, body, ipHash))
})

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return post(req, ctx)
}
