import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import type { Actor } from "@/server/auth/dal"
import { route } from "@/server/http/route"
import { pollEvents, type Surface } from "@/server/realtime/sse"

/**
 * GET /api/realtime/<surface>/poll?after=<seq> (§4.3 Degrade): the same redacted events as the
 * stream's replay, as JSON, for clients without EventSource or after repeated stream failures.
 * Every call re-authenticates, so a session that ended answers 401. Typing isn't available here.
 */
const query = z.object({ after: z.coerce.number().int().min(0).optional() }).strict()
const rate = { key: "realtime.poll", limit: 30, windowSec: 60 }

const poll = (surface: Surface) => async ({ actor, query: q }: { actor: Actor; query: z.output<typeof query> }) =>
  pollEvents({ surface, sessionId: actor.sessionId, userId: actor.userId, brandId: actor.kind === "brand" ? actor.brandId : null, ipHash: null }, q.after ?? null)

const handlers: Record<Surface, (req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>> = {
  market: route({ auth: "shopper", query, rate }, poll("market")),
  studio: route({ auth: "brand", permission: "any_member", query, rate }, poll("studio")),
  admin: route({ auth: "admin", permission: "any_admin", query, rate }, poll("admin")),
}

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  const { surface } = (await ctx.params) as { surface: string }
  const handler = handlers[surface as Surface]
  if (!handler) return Response.json({ error: { code: "not_found", message: "We couldn't find that." } }, { status: 404, headers: { "Cache-Control": "no-store" } })
  return handler(req, ctx)
}
