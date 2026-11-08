import { isSafeId } from "@/lib/api/contracts/common"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { getEvent, toEventSummary } from "@/server/payments/events"

/** GET /api/webhooks/paystack/events/{id} (admin, audit.view): one event with its stored payload. */
export const GET = route({ auth: "admin", permission: "audit.view" }, async ({ params }) => {
  if (!isSafeId(params.id)) throw notFound()
  const ev = await getEvent(params.id)
  if (!ev) throw notFound()
  return { event: { ...toEventSummary(ev), payload: ev.payload } }
})
