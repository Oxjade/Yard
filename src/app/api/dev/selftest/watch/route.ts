import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { db } from "@/server/db"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { subscribe, type BusEvent } from "@/server/realtime/bus"
import { channels } from "@/server/realtime/channels"

/**
 * GET /api/dev/selftest/watch?as=shopper|brand|admin&ms=3000 (dev only): listens on the calling
 * session's own session:<id> channel for `ms` and reports what arrived, then whether the row
 * still exists. The curl kit uses it for F14 (a switch in the same jar ends the old session at
 * once) until F2's SSE stream exists; F2 re-runs F14 against the real stream.
 */
const handler = route({ auth: "multi", as: ["shopper", "brand", "admin"], query: z.object({ as: z.enum(["shopper", "brand", "admin"]), ms: z.coerce.number().int().min(100).max(10_000).default(3000) }) }, async ({ actor, query, req }) => {
  const started = Date.now()
  const events: (BusEvent & { afterMs: number })[] = []
  const unsubscribe = subscribe([channels.session(actor.sessionId)], (e) => events.push({ ...e, afterMs: Date.now() - started }))
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, query.ms)
    req.signal.addEventListener("abort", () => {
      clearTimeout(t)
      resolve()
    })
  })
  unsubscribe()
  const d = await db()
  const row = await d.query.sessions.findFirst({ where: (s, { eq }) => eq(s.id, actor.sessionId) })
  return { sessionId: actor.sessionId, userId: actor.userId, events: events.map((e) => ({ type: e.type, payload: e.payload, afterMs: e.afterMs })), rowExists: !!row }
})

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return handler(req, ctx)
}
