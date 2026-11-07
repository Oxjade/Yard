import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { getEnv } from "@/server/env"
import { json, route } from "@/server/http/route"
import { devSetOrderState } from "@/server/shipping/dev-cleanup"

/**
 * POST /api/shipping/dev/order-state { orderId, state: "paid" | "cancelled" } (development only:
 * 404 in production, before auth; owner or engineering admins only). Stands in for the payment
 * provider and order management this build doesn't have, so the kits can test the shipment rules
 * on a paid or a cancelled order. Test shoppers' orders, or the demo shopper's browser order from
 * the last day; no payment is taken. Nothing in the app calls it.
 */
const body = z.strictObject({ orderId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), state: z.enum(["paid", "cancelled"]) })
const post = route({ auth: "admin", permission: "shipping.view", body, maxBody: 1024, rate: { key: "shipping.dev.order_state", limit: 30, windowSec: 60 } }, async ({ actor, body }) => json(await devSetOrderState(actor, body.orderId, body.state)))

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return post(req, ctx)
}
