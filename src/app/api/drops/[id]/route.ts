import { getShopper } from "@/server/auth/dal"
import { dropUpdateBody } from "@/server/drops/contracts"
import { dropDetail, loadDrop, updateDrop } from "@/server/drops/service"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** GET /api/drops/{id or slug}: the drop, its live availability and (signed in) the shopper's own state: reminder, entry, whether they can buy now. */
export const GET = route({ auth: "public", rate: { key: "drops.read", limit: 240, windowSec: 60, anonGlobal: 6000 } }, async ({ params }) => {
  const row = await loadDrop(params.id)
  if (!row) throw notFound("We couldn't find that drop.")
  return dropDetail(row, await getShopper())
})

/** PATCH /api/drops/{id} { …fields, expectedVersion }: edit a draft or a scheduled drop that hasn't started. */
export const PATCH = route(
  { auth: "brand", permission: "content.publish", body: dropUpdateBody, maxBody: 16 * 1024, rate: { key: "drops.update", limit: 60, windowSec: 60 } },
  async ({ actor, params, body, ipHash }) => {
    const row = await loadDrop(params.id, { brandId: actor.brandId })
    if (!row) throw notFound("We couldn't find that drop.")
    return { drop: await updateDrop(actor, row, body, ipHash) }
  },
)
