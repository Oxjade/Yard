import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { clearTestSignals, listTestSignals } from "@/server/signals/dev"
import { getEnv } from "@/server/env"
import { badRequest } from "@/server/http/errors"
import { route } from "@/server/http/route"

/**
 * GET /api/dev/signals?actor=<id> | ?actorPrefix=<prefix> — the chart events (newest first) and
 * the server-side follow, wishlist and reminder state of those actors.
 * DELETE /api/dev/signals?actorPrefix=u_t_… — clears the follow, wishlist and reminder state and
 * today's chart events of test actors whose id starts with the prefix, plus their in-memory
 * signal and upload rate windows, so C's and F2's tests are repeatable (§9.2).
 * Development only (404 in production); admin cookie with charts.review.
 */
const getQuery = z.object({ actor: z.string().min(3).max(80).optional(), actorPrefix: z.string().min(3).max(80).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }).strict()
const delQuery = z.object({ actorPrefix: z.string().regex(/^u_t_[a-z0-9_]*$/, "Only test accounts (u_t_…) can be cleared.") }).strict()

const getHandler = route({ auth: "admin", permission: "charts.review", query: getQuery }, async ({ query }) => {
  if (!query.actor && !query.actorPrefix) throw badRequest({ actor: "Name an actor or an actorPrefix." })
  return listTestSignals(query.actor ? { exact: query.actor } : { prefix: query.actorPrefix! }, query.limit)
})

const deleteHandler = route({ auth: "admin", permission: "charts.review", query: delQuery }, async ({ query }) => clearTestSignals(query.actorPrefix))

const devOnly = (h: (req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>) => async (req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) => {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return h(req, ctx)
}

export const GET = devOnly(getHandler)
export const DELETE = devOnly(deleteHandler)
