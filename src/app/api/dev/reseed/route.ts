import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { writeAudit } from "@/server/audit"
import { reseedModule } from "@/server/dev/reseed"
import { getEnv } from "@/server/env"
import { notFound, rule } from "@/server/http/errors"
import { route } from "@/server/http/route"

/**
 * POST /api/dev/reseed?module=<key> (§1.5): re-runs one seed module now, ignoring its recorded
 * version, so a cluster can refresh its fixtures without restarting the shared dev server.
 * Admin cookie with audit.view; 404 in production.
 */
const handler = route({ auth: "admin", permission: "audit.view", query: z.object({ module: z.string().min(1).max(40) }) }, async ({ actor, query }) => {
  const r = await reseedModule(query.module)
  if (!r.ok && r.reason === "unknown") throw notFound("There's no seed module with that key.")
  if (!r.ok && r.reason === "stub") throw rule(`${r.key} is still F1's stub (version 0): its cluster hasn't written it yet.`)
  if (!r.ok && r.reason === "waiting") throw rule(`${r.key} is waiting for ${r.missing}.`)
  await writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "dev.reseeded", target: query.module, subjectType: "seed", subjectId: query.module })
  return r
})

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return handler(req, ctx)
}
