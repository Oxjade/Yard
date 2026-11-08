import { dropVersionBody } from "@/server/drops/contracts"
import { cancelDrop, loadDrop } from "@/server/drops/service"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** POST /api/drops/{id}/cancel { expectedVersion }: cancels the drop; open checkout claims are released and draw entries closed. */
export const POST = route({ auth: "brand", permission: "content.publish", body: dropVersionBody, maxBody: 1024, rate: { key: "drops.cancel", limit: 20, windowSec: 60 } }, async ({ actor, params, body, ipHash }) => {
  const row = await loadDrop(params.id, { brandId: actor.brandId })
  if (!row) throw notFound("We couldn't find that drop.")
  return { drop: await cancelDrop(actor, row, body.expectedVersion, ipHash) }
})
