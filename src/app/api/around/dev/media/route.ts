import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { discardUnusedPlacePhotos } from "@/server/around/dev"
import { getEnv } from "@/server/env"
import { json, route } from "@/server/http/route"

/**
 * DELETE /api/around/dev/media?ids=med_a,med_b — development only (404 in production, before
 * auth). The active brand's own place photos that nothing references are deleted (row, then file),
 * so A's kits leave the demo brands with only their seeded media. Needs locations.manage.
 */
const query = z.strictObject({ ids: z.string().regex(/^[\w-]{3,64}(,[\w-]{3,64}){0,49}$/, { error: "Use ids=med_a,med_b." }) })

const del = route({ auth: "brand", permission: "locations.manage", query, rate: { key: "around.dev.media", limit: 30, windowSec: 60 } }, async ({ actor, query: q }) => json(await discardUnusedPlacePhotos(actor, q.ids.split(","))))

const notFound = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })

export async function DELETE(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return notFound()
  return del(req, ctx)
}
