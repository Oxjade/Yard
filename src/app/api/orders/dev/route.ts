import { connection, type NextRequest } from "next/server"
import { z } from "zod"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { ageDelivery, declineCancelRefund, DEV_JOBS, runJobFor } from "@/server/orders/dev"

/**
 * Test-only helpers for the ORDERS acceptance kit (scripts/checks/v3-orders.mjs). DEVELOPMENT ONLY:
 * 404 in production before anything else runs. Limited to orders of kit products (a line title
 * containing "t_v3_"); any other order id → 404 and nothing runs.
 *
 * POST { op: "run-job", job: hourly|complete|sync|retry-cancelled|expire-returns, orderIds, at? }
 *   → that job's result, over the given orders only, as if the time were `at` (ISO, default now)
 * POST { op: "age-delivery", orderId, days } → moves the order's delivery `days` into the past
 * POST { op: "decline-cancel-refund", orderId, restock } → a paid order cancelled by its brand
 *   whose cancellation refund the provider declined (stub refunds always succeed)
 */
const orderId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("run-job"), job: z.enum(DEV_JOBS), orderIds: z.array(orderId).min(1).max(50), at: z.string().datetime({ offset: true }).optional() }).strict(),
  z.object({ op: z.literal("age-delivery"), orderId, days: z.number().min(0).max(120) }).strict(),
  z.object({ op: z.literal("decline-cancel-refund"), orderId, restock: z.boolean() }).strict(),
])

const handler = route({ auth: "public", body, maxBody: 4 * 1024 }, async ({ body }) => {
  if (body.op === "run-job") return { job: body.job, result: await runJobFor(body.job, body.orderIds, body.at) }
  if (body.op === "decline-cancel-refund") return declineCancelRefund(body.orderId, body.restock)
  return ageDelivery(body.orderId, body.days)
})

const off = () => Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return off()
  return handler(req, ctx)
}
