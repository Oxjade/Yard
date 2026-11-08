import { z } from "zod"
import { writeAudit } from "@/server/audit"
import { getEnv } from "@/server/env"
import { forbidden, notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { paymentsConfig } from "@/server/payments/config"
import { processEvent, recordProviderEvent, toEventSummary, getEvent } from "@/server/payments/events"

const simulateBody = z
  .object({
    event: z.enum(["charge.success", "charge.failed", "refund.processed", "refund.failed", "transfer.success", "transfer.failed", "transfer.reversed", "charge.dispute.create", "charge.dispute.resolve"]),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()

/**
 * POST /api/webhooks/paystack/simulate { event, data } — DEVELOPMENT ONLY, STUB ONLY (admin:
 * owner or engineering). Feeds a provider-shaped event through the same processing as the
 * webhook, stored with source 'simulated' and provider 'stub' — e.g. completing a stub payout
 * with { event: "transfer.success", data: { reference } }. 404 in production or with Paystack keys.
 */
export const POST = route({ auth: "admin", permission: "audit.view", body: simulateBody, maxBody: 16 * 1024 }, async ({ actor, body, ipHash }) => {
  if (!getEnv().dev || paymentsConfig().provider !== "stub") throw notFound()
  if (actor.role !== "owner" && actor.role !== "engineering") throw forbidden()
  const payload = { event: body.event, data: { ...body.data, simulated: true, nonce: Date.now() } }
  const ev = await recordProviderEvent({ provider: "stub", source: "simulated", payload, rawBody: JSON.stringify(payload), signatureValid: false })
  const result = await processEvent(ev.id)
  await writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "payments.event_simulated", subjectType: "provider_event", subjectId: ev.id, ipHash, meta: { eventType: body.event } })
  const after = await getEvent(ev.id)
  return { result, event: after ? toEventSummary(after) : null }
})
