import { connection, type NextRequest } from "next/server"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { checkLate } from "@/server/shipping/late"

/**
 * POST /api/shipping/dev/check-late (development only, 404 in production; admin with
 * shipping.view): runs the hourly late check now, so the delivery checks don't wait an hour.
 */
const handler = route({ auth: "admin", permission: "shipping.view", rate: { key: "shipping.dev.check_late", limit: 10, windowSec: 60 } }, async () => checkLate())

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return handler(req, ctx)
}
