import "server-only"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { courierEvents } from "../db/schema/courier"
import { newId } from "../ids"
import { log } from "../log"
import { applyCourierUpdate } from "./courier-book"
import { webhookEventKey } from "./providers/shipbubble-core"
import type { CourierProvider } from "./providers/courier-types"

/**
 * A verified courier webhook: stored once (courier_events, kind 'webhook', by a hash of the body),
 * then applied. A body seen before and applied answers "duplicate"; one whose earlier attempt
 * failed is applied again (the provider's retry).
 */
export async function recordCourierWebhook(p: CourierProvider, rawBody: string): Promise<{ status: "applied" | "duplicate" | "invalid" | "failed" }> {
  let parsed
  try {
    parsed = p.parseWebhook(rawBody)
  } catch (e) {
    log.warn(`[yard] ${p.label} webhook unreadable: ${e instanceof Error ? e.message : String(e)}`)
    return { status: "invalid" }
  }
  const key = webhookEventKey(rawBody)
  const d = await db()
  const [inserted] = await d
    .insert(courierEvents)
    .values({ id: newId("cev"), provider: p.id, kind: "webhook", eventKey: key, status: parsed.status, detail: `${parsed.event ?? "event"} · ${parsed.providerStatus ?? parsed.status} · ${parsed.providerOrderId}`.slice(0, 300) })
    .onConflictDoNothing()
    .returning({ id: courierEvents.id })
  if (!inserted) {
    const [prev] = await d.select({ detail: courierEvents.detail }).from(courierEvents).where(eq(courierEvents.eventKey, key)).limit(1)
    if (!prev?.detail?.startsWith("FAILED")) return { status: "duplicate" }
  }
  try {
    await applyCourierUpdate(p.id, parsed, "webhook")
    if (!inserted) await d.update(courierEvents).set({ detail: `${parsed.event ?? "event"} · ${parsed.providerStatus ?? parsed.status} · ${parsed.providerOrderId}`.slice(0, 300) }).where(eq(courierEvents.eventKey, key))
    return { status: "applied" }
  } catch (e) {
    log.error(`[yard] ${p.label} webhook for ${parsed.providerOrderId} failed; the provider retries`, e)
    await d.update(courierEvents).set({ detail: `FAILED ${parsed.event ?? "event"} · ${parsed.providerOrderId}`.slice(0, 300) }).where(eq(courierEvents.eventKey, key))
    return { status: "failed" }
  }
}
