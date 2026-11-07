import { requireAdmin } from "@/server/auth/dal"
import { getEnv } from "@/server/env"
import { badRequest, notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { setSandboxDelay } from "@/server/social/state"

/**
 * POST /api/social/dev/slow-sync?ms= (development only, 404 in production before auth or input;
 * then an admin with audit.view): each sandbox file copy waits `ms` (0–2000) for the next two
 * minutes, so the curl kit can land a Disconnect in the middle of a sandbox sync and check that it
 * wins. 0 turns it off. Live providers are never slowed.
 */
export const POST = route({ auth: "public" }, async ({ req }) => {
  if (!getEnv().dev) throw notFound()
  await requireAdmin("audit.view")
  const raw = req.nextUrl.searchParams.get("ms") ?? ""
  const ms = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN
  if (!(ms >= 0 && ms <= 2000)) throw badRequest({ ms: "Use 0 to 2000." })
  setSandboxDelay(ms)
  return { ms, forSeconds: ms ? 120 : 0 }
})
