import { connection, type NextRequest } from "next/server"
import type { Actor } from "@/server/auth/dal"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { openStream, type Surface } from "@/server/realtime/sse"

/**
 * GET /api/realtime/market | studio | admin (§4.2). Each surface reads only its own cookie:
 * market → yard_s (user:<id>, session:<sid>), studio → yard_b (brand:<active brand>,
 * member:<id>, session:<sid>), admin → yard_a (admin, admin:<id>, session:<sid>). No cookie →
 * 401, so anonymous shoppers get no stream. Stream caps: src/server/realtime/streams.ts. route() awaits connection() first, so the infinite
 * response is never prerendered.
 */
/**
 * The per-IP cap (20) applies when the client IP is known (§5.1). In development the shared dev
 * server sees every local browser and script as one loopback address, so loopback is left out of
 * that cap there (the per-session and process caps still apply); the curl kit exercises the IP cap
 * with a non-loopback X-Forwarded-For, playing the trusted proxy.
 */
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/
const capIpHash = (ip: string | null, ipHash: string | null) => (ip && getEnv().dev && LOOPBACK.test(ip) ? null : ipHash)

const open = (surface: Surface) => async ({ actor, req, ip, ipHash }: { actor: Actor; req: NextRequest; ip: string | null; ipHash: string | null }) =>
  openStream({ surface, sessionId: actor.sessionId, userId: actor.userId, brandId: actor.kind === "brand" ? actor.brandId : null, ipHash: capIpHash(ip, ipHash) }, req)

// Reconnect storms are bounded here; open streams are bounded by the caps in streams.ts.
const rate = { key: "realtime.open", limit: 60, windowSec: 60 }

const handlers: Record<Surface, (req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>> = {
  market: route({ auth: "shopper", rate }, open("market")),
  studio: route({ auth: "brand", permission: "any_member", rate }, open("studio")),
  admin: route({ auth: "admin", permission: "any_admin", rate }, open("admin")),
}

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  const { surface } = (await ctx.params) as { surface: string }
  const handler = handlers[surface as Surface]
  if (!handler) return Response.json({ error: { code: "not_found", message: "We couldn't find that." } }, { status: 404, headers: { "Cache-Control": "no-store" } })
  return handler(req, ctx)
}
