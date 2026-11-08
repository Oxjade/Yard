import { isSafeId } from "@/lib/api/contracts/common"
import { writeAudit } from "@/server/audit"
import { db } from "@/server/db"
import { providerEvents } from "@/server/db/schema/payments"
import { forbidden, notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { getEvent, processEvent, toEventSummary } from "@/server/payments/events"
import { eq } from "drizzle-orm"

/** Roles that may re-run money events (no finance permission exists in the shared table yet). */
const REPLAY_ROLES = new Set(["owner", "engineering", "finance"])

/**
 * POST /api/webhooks/paystack/events/{id}/replay (admin: owner, engineering or finance). Re-processes
 * a stored event from its raw payload. Every handler is idempotent, so replaying an event that was
 * already applied changes nothing. Audited.
 */
export const POST = route({ auth: "admin", permission: "audit.view", rate: { key: "payments.replay", limit: 30, windowSec: 60 } }, async ({ actor, params, ipHash }) => {
  if (!REPLAY_ROLES.has(actor.role)) throw forbidden()
  if (!isSafeId(params.id)) throw notFound()
  const ev = await getEvent(params.id)
  if (!ev) throw notFound()
  const d = await db()
  await d.update(providerEvents).set({ lastReplayBy: actor.userId }).where(eq(providerEvents.id, ev.id))
  const result = await processEvent(ev.id, { force: true })
  await writeAudit({
    actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
    action: "payments.event_replay",
    subjectType: "provider_event",
    subjectId: ev.id,
    target: ev.subjectRef,
    ipHash,
    meta: { eventType: ev.eventType, before: ev.status, after: result.status },
  })
  const after = await getEvent(ev.id)
  return { result, event: after ? toEventSummary(after) : null }
})
