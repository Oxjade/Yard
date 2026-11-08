import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { restoreBody, restoreShipping, snapshotShipping } from "@/server/setup/dev-shipping"

/**
 * Development only (404 in production, before auth). Owner or engineering admins only. N's kit
 * takes a snapshot of one brand's shipping before the save that ticks the setup card, and puts it
 * back exactly afterwards (see src/server/setup/dev-shipping.ts):
 * GET  ?brandId=b_lagos_static → that brand's shipping rows
 * POST { snapshot, actorId } → restores those rows and deletes only that actor's save audit rows since the snapshot
 */
const query = z.strictObject({ brandId: z.string().regex(/^b_[a-z0-9_]{1,60}$/) })
const rate = { key: "setup.dev.shipping", limit: 30, windowSec: 60 }

const get = route({ auth: "admin", permission: "shipping.view", query, rate }, async ({ actor, query }) => snapshotShipping(actor, query.brandId))
const post = route({ auth: "admin", permission: "shipping.view", body: restoreBody, rate }, async ({ actor, body }) => restoreShipping(actor, body))

const notFound = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return notFound()
  return get(req, ctx)
}

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return notFound()
  return post(req, ctx)
}
