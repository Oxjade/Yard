import { z } from "zod"
import { route } from "@/server/http/route"
import { listEvents } from "@/server/payments/events"
import { PROVIDER_EVENT_STATUSES } from "@/server/db/schema/payments"

const eventsQuery = z.object({
  status: z.enum(PROVIDER_EVENT_STATUSES).optional(),
  type: z.string().regex(/^[a-z._]{1,80}$/, { error: "That event type isn't valid." }).optional(),
  ref: z.string().regex(/^[\w.=-]{1,200}$/, { error: "That reference isn't valid." }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** GET /api/webhooks/paystack/events?status=failed&type=charge.success&ref=… (admin, audit.view): the raw provider event log, newest first. */
export const GET = route({ auth: "admin", permission: "audit.view", query: eventsQuery }, async ({ query }) => ({ events: await listEvents(query) }))
