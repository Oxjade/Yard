import { z } from "zod"
import { safeId } from "@/lib/api/contracts/common"
import { requireAdmin } from "@/server/auth/dal"
import { devAdmin } from "@/server/catalog/dev"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

const body = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("moderate"), productId: safeId(), hidden: z.boolean(), reason: z.string().min(1).max(500) }),
  z.strictObject({ action: z.literal("review"), onboardingId: safeId(), decision: z.enum(["approve", "reject"]), note: z.string().max(1000).optional() }),
  z.strictObject({ action: z.literal("publishScheduled") }),
  z.strictObject({ action: z.literal("backdateSchedule"), productId: safeId() }),
])

/**
 * POST /api/studio/catalog/dev/admin (DEVELOPMENT ONLY: 404 in production before auth; then an
 * admin with content.moderate). Calls the admin-side CATALOG functions that have no admin route
 * yet (setProductModeration, reviewOnboarding, the publishScheduled job) on t_v3_ test data only.
 */
export const POST = route({ auth: "public", body }, async ({ body, ipHash }) => {
  if (!getEnv().dev) throw notFound()
  const actor = await requireAdmin("content.moderate")
  return devAdmin(actor, body, ipHash)
})
