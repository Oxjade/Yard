import "server-only"
import { and, eq, ilike, inArray, sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { shipmentEvents } from "../db/schema"
import { orderLines, orderRefunds, orderStates } from "../db/schema/orders-v3"
import { notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { restockLines } from "./cancel"
import { addEvent, linesOf, lockOrder, setMerchantStatus, updateState } from "./core"
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
      // Both the reported and the recorded time: the return window runs from the later of the two.
      .set({ occurredAt: sql`${shipmentEvents.occurredAt} - make_interval(secs => ${secs})`, createdAt: sql`${shipmentEvents.createdAt} - make_interval(secs => ${secs})` })
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

/**
 * The stub provider settles every refund at once, so a declined cancellation refund can't happen
 * here. This puts a paid kit order in exactly the state cancelOrder leaves when the provider
 * declines its refund: cancelled by the brand (with its restock choice applied), a 'failed'
 * cancellation refund under the first key, payment still 'paid', nothing posted to the ledger.
 */
export async function declineCancelRefund(orderId: string, restock: boolean) {
  const [id] = await taggedOrderIds([orderId])
  return withTx(async (tx) => {
    const locked = await lockOrder(tx, id)
    if (!locked) throw notFound()
    const { order, state } = locked
    if (state.paymentStatus !== "paid" || state.fulfilmentStatus === "cancelled" || state.refundedMinor > 0) throw rule("Only a paid, uncancelled, unrefunded kit order.")
    const now = new Date()
    await updateState(tx, id, { fulfilmentStatus: "cancelled", cancelledAt: now, cancelledBy: "brand", cancelReason: "Kit: declined cancellation refund" })
    await setMerchantStatus(tx, id, "cancelled")
    await addEvent(tx, id, "order.cancelled", { kind: "brand", id: null }, { by: "brand", paid: true, restock })
    if (restock) await restockLines(tx, order, await linesOf(tx, id), null, "Order cancelled")
    const refundId = newId("orf")
    await tx.insert(orderRefunds).values({ id: refundId, orderRefId: id, brandId: order.brandId, kind: "cancellation", status: "failed", amountMinor: state.totalMinor, currency: state.currency, reason: "Order cancelled before dispatch", idempotencyKey: `cancel:${id}`, requestedByKind: "brand", requestedBy: null, failureReason: "Kit: the provider declined the refund.", settledAt: now })
    await addEvent(tx, id, "refund.failed", { kind: "provider", id: null }, { refundId, amountMinor: state.totalMinor })
    return { refundId }
  })
}
