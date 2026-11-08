import { loadDrop, setReminder } from "@/server/drops/service"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"

/** POST /api/drops/{id}/reminder: remind me before release (in-app and email, per my preferences). Also records the reminder_set signal. */
export const POST = route({ auth: "shopper", rate: { key: "drops.reminder", limit: 60, windowSec: 60 } }, async ({ actor, params, ipHash, req }) => {
  const row = await loadDrop(params.id)
  if (!row) throw notFound("We couldn't find that drop.")
  return setReminder(actor, row, true, { ipHash, userAgent: req.headers.get("user-agent") })
})

/** DELETE /api/drops/{id}/reminder. */
export const DELETE = route({ auth: "shopper", rate: { key: "drops.reminder", limit: 60, windowSec: 60 } }, async ({ actor, params, ipHash, req }) => {
  const row = await loadDrop(params.id)
  if (!row) throw notFound("We couldn't find that drop.")
  return setReminder(actor, row, false, { ipHash, userAgent: req.headers.get("user-agent") })
})
