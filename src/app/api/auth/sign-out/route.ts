import { actorQuery } from "@/server/auth/contracts"
import { writeAudit } from "@/server/audit"
import { getAdmin } from "@/server/auth/dal"
import { clearSessionCookie, endCurrentSession, type ActorKind } from "@/server/auth/session"
import { withTx } from "@/server/db"
import { route } from "@/server/http/route"

/**
 * POST /api/auth/sign-out?actor=shopper|brand|admin. Ends this browser's session of that kind
 * (demo or real) and clears its cookie. Always succeeds, so nobody is left holding a session.
 */
export const POST = route({ rate: { key: "auth.sign_out", limit: 60, windowSec: 60 }, auth: "public", query: actorQuery }, async ({ query, ipHash }) => {
  const actor: ActorKind = query.actor
  const admin = actor === "admin" ? await getAdmin() : null
  await withTx(async () => {
    const row = await endCurrentSession(actor, "signed_out")
    if (row && admin) await writeAudit({ actor: { kind: "admin", id: admin.userId, name: admin.name, role: admin.role }, action: "admin.signed_out", target: admin.name, subjectType: "session", subjectId: row.id, ipHash })
  })
  await clearSessionCookie(actor)
  return { ok: true }
})
