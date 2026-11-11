import { z } from "zod"
import { safeId } from "@/lib/api/contracts/common"
import { requireShopper } from "@/server/auth/dal"
import { devForceLine, MAX_QTY } from "@/server/cart"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { json, route } from "@/server/http/route"

const body = z.strictObject({ variantId: safeId(), qty: z.number().int().min(1).max(MAX_QTY) })

/**
 * POST /api/cart/dev { variantId, qty } (DEVELOPMENT ONLY: 404 in production before auth; then a signed-in shopper).
 * Forces a kit product's line into the cart without the sellable check, so the founding-brand kit
 * can prove checkout itself refuses a brand that isn't selling yet. Kit products (t_v3_) only.
 */
export const POST = route({ auth: "public", body, maxBody: 1024 }, async ({ body }) => {
  if (!getEnv().dev) throw notFound()
  const actor = await requireShopper()
  await devForceLine({ kind: "customer", customerId: actor.userId }, body.variantId, body.qty)
  return json({ ok: true }, 201)
})
