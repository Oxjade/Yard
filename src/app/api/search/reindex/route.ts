import { writeAudit } from "@/server/audit"
import { withTx } from "@/server/db"
import { route } from "@/server/http/route"
import { reindexAll } from "@/server/search"

/** POST /api/search/reindex: rebuilds the search index (admins; also runs daily). */
export const POST = route({ auth: "admin", permission: "any_admin", rate: { key: "search.reindex", limit: 2, windowSec: 300 } }, async ({ actor, ipHash }) => {
  const out = await withTx(() => reindexAll())
  await withTx(() => writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "search.reindex", subjectType: "search", ipHash, meta: out }))
  return out
})
