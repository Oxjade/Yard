import { isSafeId } from "@/lib/api/contracts/common"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { getEvent, redactProviderPayload, toEventSummary } from "@/server/payments/events"

/** GET /api/webhooks/paystack/events/{id} (admin, audit.view): one event with its stored payload, card token and customer contact details withheld. */
export const GET = route({ rate: { key: "payments.events.read", limit: 120, windowSec: 60 }, auth: "admin", permission: "audit.view" }, async ({ params }) => {
  if (!isSafeId(params.id)) throw notFound()
  const ev = await getEvent(params.id)
  if (!ev) throw notFound()
  return { event: { ...toEventSummary(ev), payload: redactProviderPayload(ev.payload) } }
})
