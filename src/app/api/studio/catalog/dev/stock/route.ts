import { z } from "zod"
import { safeId } from "@/lib/api/contracts/common"
import { requireActiveBrand } from "@/server/auth/dal"
import { devStock } from "@/server/catalog/dev"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

const holdKey = z.string().max(90)
const body = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("hold"), holdKey, lines: z.array(z.strictObject({ variantId: safeId(), qty: z.number().int() })).min(1).max(50), ttlMinutes: z.number().int().optional() }),
  z.strictObject({ action: z.enum(["commit", "release", "expire", "holds"]), holdKey }),
  z.strictObject({ action: z.literal("restock"), variantId: safeId(), qty: z.number().int(), reason: z.string().max(200) }),
])

/**
 * POST /api/studio/catalog/dev/stock (DEVELOPMENT ONLY: 404 in production before auth; then a
 * brand member with orders.fulfil). Drives the CATALOG stock contract for the acceptance kit:
 * hold / commit / release / restock / expire (backdate + sweep job) / holds. Hold keys must start
 * with t_v3_ and variants must be the active brand's.
 */
export const POST = route({ auth: "public", body }, async ({ body }) => {
  if (!getEnv().dev) throw notFound()
  const actor = await requireActiveBrand("orders.fulfil")
  return devStock(actor, body)
})
