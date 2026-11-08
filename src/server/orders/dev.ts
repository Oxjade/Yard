import "server-only"
import { and, eq, ilike, inArray, sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { shipmentEvents } from "../db/schema"
import { orderLines, orderStates } from "../db/schema/orders-v3"
import { notFound } from "../http/errors"
import { completeDue, hourly, retryCancelledRefunds, syncFulfilmentDue } from "./jobs"
import { expireStaleReturns } from "./returns"

/**
 * Test-only helpers for the ORDERS acceptance kit (scripts/checks/v3-orders.mjs). The route that
 * calls these answers 404 in production before anything runs. Every operation is limited to
 * orders of kit products (an order line whose title contains "t_v3_", which kits put in their
 * product titles), so a kit can never run a job on, or age, seeded or real orders.
 */
const TAG_LIKE = "%t\\_v3\\_%"

/** The given ids, only if every one is a kit order (else 404: nothing runs). */
export async function taggedOrderIds(ids: string[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) throw notFound()
  const d = await db()
  const rows = await d
    .selectDistinct({ id: orderLines.orderRefId })
    .from(orderLines)
    .where(and(inArray(orderLines.orderRefId, unique), ilike(orderLines.title, TAG_LIKE)))
  if (rows.length !== unique.length) throw notFound("No such test order.")
  return unique
}

export const DEV_JOBS = ["hourly", "complete", "sync", "retry-cancelled", "expire-returns"] as const

/** Runs one ORDERS job over the kit's orders only, optionally as if it were `at`. */
export async function runJobFor(job: (typeof DEV_JOBS)[number], orderIds: string[], at?: string) {
  const only = await taggedOrderIds(orderIds)
  const now = at ? Date.parse(at) : Date.now()
  switch (job) {
    case "hourly":
      return hourly({ now, only })
    case "complete":
      return completeDue(now, only)
    case "sync":
      return syncFulfilmentDue(only)
    case "retry-cancelled":
      return retryCancelledRefunds(only)
    case "expire-returns":
      return expireStaleReturns(now, only)
  }
}

/**
 * Moves a kit order's delivery `days` into the past (its delivered shipment event and stored
 * delivery / return-window times), so the return-window and completion rules can be checked
 * without waiting a week.
 */
export async function ageDelivery(orderId: string, days: number) {
  const [id] = await taggedOrderIds([orderId])
  const secs = Math.round(days * 86_400)
  return withTx(async (tx) => {
    const ev = await tx
      .update(shipmentEvents)
      .set({ occurredAt: sql`${shipmentEvents.occurredAt} - make_interval(secs => ${secs})` })
      .where(and(eq(shipmentEvents.orderRefId, id), eq(shipmentEvents.status, "delivered")))
      .returning({ id: shipmentEvents.id })
    const st = await tx
      .update(orderStates)
      .set({
        deliveredAt: sql`${orderStates.deliveredAt} - make_interval(secs => ${secs})`,
        returnWindowEndsAt: sql`${orderStates.returnWindowEndsAt} - make_interval(secs => ${secs})`,
      })
      .where(eq(orderStates.orderRefId, id))
      .returning({ id: orderStates.orderRefId })
    return { events: ev.length, states: st.length }
  })
}
