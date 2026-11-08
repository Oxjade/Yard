import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { getEnv } from "@/server/env"
import { json, route } from "@/server/http/route"
import { devCleanup, devListPlaced } from "@/server/shipping/dev-cleanup"

/**
 * Development only (404 in production, before auth). Owner or engineering admins only (403 for
 * other admins). D's kits call it last, so the demo accounts see only the seeded sample data.
 * GET  ?customer=u_ada → that shopper's non-seed checkouts (what a browser run left)
 * POST { groupIds?, references?, actorPrefix?, customers?, since?, dryRun? } → see devCleanup for the
 * scoping rules (a sweep is the caller's own run only: its test shoppers AND its start time)
 */
const ids = z.array(z.string().trim().regex(/^[\w-]{3,64}$/)).max(200)
const body = z.strictObject({
  groupIds: ids.optional(),
  references: ids.optional(),
  actorPrefix: z.string().regex(/^u_t_[a-z0-9_]{1,40}$/).optional(),
  customers: z.array(z.string().regex(/^u_t_[a-z0-9_]{1,40}$/)).max(20).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  dryRun: z.boolean().optional(),
})
const query = z.strictObject({ customer: z.string().trim().regex(/^u_[a-z0-9_]{1,40}$/) })

const post = route({ auth: "admin", permission: "shipping.view", body, rate: { key: "shipping.dev.cleanup", limit: 30, windowSec: 60 } }, async ({ actor, body }) => json(await devCleanup(actor, body)))
const get = route({ auth: "admin", permission: "shipping.view", query, rate: { key: "shipping.dev.cleanup", limit: 30, windowSec: 60 } }, async ({ actor, query }) => json({ items: await devListPlaced(actor, query.customer) }))

const notFound = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return notFound()
  return post(req, ctx)
}

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return notFound()
  return get(req, ctx)
}
