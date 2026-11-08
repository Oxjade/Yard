import { enterDraw, loadDrop, withdrawEntry } from "@/server/drops/service"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** POST /api/drops/{id}/entry: enter a draw while entries are open (one entry per shopper). */
export const POST = route({ auth: "shopper", rate: { key: "drops.enter", limit: 20, windowSec: 60, daily: 200 } }, async ({ actor, params }) => {
  const row = await loadDrop(params.id)
  if (!row) throw notFound("We couldn't find that drop.")
  return enterDraw(actor, row)
})

/** DELETE /api/drops/{id}/entry: withdraw before the draw. */
export const DELETE = route({ auth: "shopper", rate: { key: "drops.enter", limit: 20, windowSec: 60 } }, async ({ actor, params }) => {
  const row = await loadDrop(params.id)
  if (!row) throw notFound("We couldn't find that drop.")
  return withdrawEntry(actor, row)
})
