import { dropVersionBody } from "@/server/drops/contracts"
import { loadDrop, scheduleDrop, unscheduleDrop } from "@/server/drops/service"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

const opts = { auth: "brand", permission: "content.publish", body: dropVersionBody, maxBody: 1024, rate: { key: "drops.schedule", limit: 30, windowSec: 60 } } as const

/** POST /api/drops/{id}/schedule { expectedVersion }: publish a draft for its release time (draws commit their seed hash here). */
export const POST = route(opts, async ({ actor, params, body, ipHash }) => {
  const row = await loadDrop(params.id, { brandId: actor.brandId })
  if (!row) throw notFound("We couldn't find that drop.")
  return { drop: await scheduleDrop(actor, row, body.expectedVersion, ipHash) }
})

/** DELETE /api/drops/{id}/schedule { expectedVersion }: back to draft, before it starts and before anyone has entered. */
export const DELETE = route(opts, async ({ actor, params, body, ipHash }) => {
  const row = await loadDrop(params.id, { brandId: actor.brandId })
  if (!row) throw notFound("We couldn't find that drop.")
  return { drop: await unscheduleDrop(actor, row, body.expectedVersion, ipHash) }
})
