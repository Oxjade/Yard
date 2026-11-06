import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { deletionStatus } from "@/server/social/meta"

/** GET /api/social/data-deletion/{code}: { status } only, for the status page (no account or brand details). */
export const GET = route({ auth: "public", rate: { key: "social.deletion-status", limit: 60, windowSec: 60, anonGlobal: 600 } }, async ({ params }) => {
  const s = await deletionStatus(params.code ?? "")
  if (!s) throw notFound("We couldn't find a request with that code.")
  return s
})
