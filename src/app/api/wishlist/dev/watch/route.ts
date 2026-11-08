import { writeAudit } from "@/server/audit"
import { withTx } from "@/server/db"
import { getEnv } from "@/server/env"
import { watchPrices } from "@/server/follows"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/**
 * POST /api/wishlist/dev/watch — DEVELOPMENT ONLY (404 elsewhere), any admin. Runs the hourly
 * price-drop / back-in-stock watch (follows.watchPrices) now, exactly as the scheduler would, so
 * the ENGAGEMENT acceptance kit (scripts/checks/v3-engagement.mjs) can exercise it. Audited.
 */
export const POST = route({ auth: "admin", permission: "any_admin", rate: { key: "wishlist.dev.watch", limit: 20, windowSec: 60 } }, async ({ actor, ipHash }) => {
  if (!getEnv().dev) throw notFound()
  const out = await watchPrices()
  await withTx(() => writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "wishlist.watch_run", subjectType: "search", ipHash, meta: out }))
  return out
})
