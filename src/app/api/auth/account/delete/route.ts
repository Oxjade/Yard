import { deleteAccountBody } from "@/server/auth/contracts"
import { deletionStatus, requestAccountDeletion } from "@/server/auth/erasure"
import { metaOf } from "@/server/auth/http"
import { requireRecentReauth } from "@/server/auth/reauth"
import { clearSessionCookie } from "@/server/auth/session"
import { route } from "@/server/http/route"

/** GET /api/auth/account/delete → { deletion: { status, requestedAt } | null }. */
export const GET = route({ auth: "shopper" }, async ({ actor }) => ({ deletion: await deletionStatus(actor.userId) }))

/**
 * POST /api/auth/account/delete { confirm: "DELETE" } → { ok, requestId }. Needs a re-auth in the
 * last 10 minutes (403 fields.reauth = "required" otherwise). Ends every session at once; the
 * erasure job anonymises the account right after.
 */
export const POST = route({ auth: "shopper", body: deleteAccountBody, maxBody: 1024 }, async ({ req, actor, ipHash }) => {
  await requireRecentReauth(actor, 600)
  const out = await requestAccountDeletion(actor, metaOf(req, ipHash))
  await clearSessionCookie("shopper")
  return out
})
