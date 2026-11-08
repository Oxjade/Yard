import "server-only"
import { and, desc, eq, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import { restock } from "../catalog"
import type { Tx } from "../db"
import { orderEvents, orderLines, orderRefunds } from "../db/schema/orders-v3"
import { conflict, notFound, rule } from "../http/errors"
import { log } from "../log"
import { addEvent, announce, brandName, committedRefunds, deriveFulfilment, emailCustomer, linesOf, lockOrder, orderUrl, setMerchantStatus, shipmentEventsFor, SYSTEM, updateState, type OrderActor, type OrderLineRow, type OrderRefRow } from "./core"
import { issueRefund, money } from "./refunds"

const CANCELLABLE_MERCHANT = new Set(["pending_payment", "paid", "processing"])
const CAPTURED = new Set(["paid", "partially_refunded"])

/** Puts units back into stock through CATALOG and records it on the line (never more than was sold). */
export async function restockLines(tx: Tx, order: Pick<OrderRefRow, "id" | "reference">, lines: OrderLineRow[], qtyByLine: Map<string, number> | null, reason: string) {
  let total = 0
  for (const l of lines) {
    const want = qtyByLine ? (qtyByLine.get(l.id) ?? 0) : l.qty
    const qty = Math.min(want, l.qty - l.restockedQty)
    if (qty <= 0) continue
    await restock(tx, { variantId: l.variantId, qty, reason: `${reason} (${order.reference})` })
    await tx
      .update(orderLines)
      .set({ restockedQty: sql`${orderLines.restockedQty} + ${qty}` })
      .where(eq(orderLines.id, l.id))
    total += qty
  }
  return total
}

export type CancelInput = {
  orderRefId: string
  actor: OrderActor
  reason: string
  restock: boolean
  idempotencyKey: string
  /** Scoping: the order must be this shopper's / this brand's, else 404. */
  customerId?: string
  brandId?: string
}

/**
 * Cancels an order before dispatch (nothing shipped yet). Paid: refunded in full (PAYMENTS →
 * LEDGER) and restocked. Unpaid: cancelled; CHECKOUT's stock hold expires on its own, and if the
 * payment still lands, markCheckoutPaid refunds it. Idempotent: cancelling a cancelled order
 * returns it unchanged.
 */
export async function cancelOrder(tx: Tx, input: CancelInput) {
  const locked = await lockOrder(tx, input.orderRefId)
  if (!locked) throw notFound()
  const { order, state } = locked
  if ((input.customerId && order.customerId !== input.customerId) || (input.brandId && order.brandId !== input.brandId)) throw notFound()
  if (state.fulfilmentStatus === "cancelled" || order.status === "cancelled") return { orderId: order.id, alreadyCancelled: true, refundId: null as string | null }

  const events = (await shipmentEventsFor(tx, [order.id])).get(order.id) ?? []
  const f = deriveFulfilment(state, order, events)
  if (f.shipped || !CANCELLABLE_MERCHANT.has(order.status)) throw rule("This order has already been dispatched, so it can't be cancelled. Once it arrives, you can request a return.")
  if (state.returnStatus === "requested" || state.returnStatus === "approved") throw conflict("This order has a return in progress.")
  if (state.disputeStatus === "open") throw conflict("This order's payment is disputed. Yard's team will settle it.")

  const now = new Date()
  const by = input.actor.kind === "provider" ? "system" : input.actor.kind
  await updateState(tx, order.id, { fulfilmentStatus: "cancelled", cancelledAt: now, cancelledBy: by, cancelReason: input.reason.slice(0, 200) })
  await setMerchantStatus(tx, order.id, "cancelled")
  // `paid` + `restock` record the stock decision made here, so the refund sweep never overrides it.
  await addEvent(tx, order.id, "order.cancelled", input.actor, { by, paid: CAPTURED.has(state.paymentStatus), restock: input.restock })

  let refundId: string | null = null
  let refundMinor = 0
  if (CAPTURED.has(state.paymentStatus)) {
    const remaining = state.totalMinor - (await committedRefunds(tx, order.id))
    if (remaining > 0) {
      const k = await cancellationRefundKey(tx, order.id)
      if (k) {
        const r = await issueRefund(tx, { orderRefId: order.id, amountMinor: remaining, reason: "Order cancelled before dispatch", kind: "cancellation", idempotencyKey: k, actor: input.actor })
        refundId = r.refund.id
        refundMinor = remaining
      }
    }
    if (input.restock) await restockLines(tx, order, await linesOf(tx, order.id), null, "Order cancelled")
  }

  if (input.actor.kind === "brand" || input.actor.kind === "admin") {
    await writeAudit({
      actor: { kind: input.actor.kind, id: input.actor.id, name: input.actor.name, role: input.actor.role },
      action: "order.cancelled",
      target: `Order ${order.reference}`,
      subjectType: "order_ref",
      subjectId: order.id,
      brandId: order.brandId,
      reason: input.reason.slice(0, 200),
      meta: { paid: CAPTURED.has(state.paymentStatus), refundId, restock: input.restock },
    })
  }
  await emailCustomer(tx, order.customerId, "order_cancelled", { reference: order.reference, brand: await brandName(tx, order.brandId), by, reason: input.reason.slice(0, 200), charged: CAPTURED.has(state.paymentStatus) ? 1 : 0, ...(refundId && refundMinor > 0 ? { amount: money(refundMinor, state.currency) } : {}), url: orderUrl(order.id) }, `order-cancelled:${order.id}`)
  await announce(order, "cancelled")
  return { orderId: order.id, alreadyCancelled: false, refundId }
}

/** A provider-declined cancellation refund is re-requested at most this many times, then left for Yard's team. */
export const CANCEL_REFUND_ATTEMPTS = 5

/**
 * The idempotency key for the next cancellation refund attempt. The first is `cancel:<order>`;
 * each attempt the provider declined ('failed') moves to a new key, so a retry really reaches
 * the provider instead of returning the failed row as a duplicate. A pending or succeeded attempt
 * keeps its key (the cap and the duplicate lookup stop a second request). Null once
 * CANCEL_REFUND_ATTEMPTS attempts have failed.
 */
async function cancellationRefundKey(tx: Tx, orderRefId: string): Promise<string | null> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orderRefunds)
    .where(and(eq(orderRefunds.orderRefId, orderRefId), eq(orderRefunds.kind, "cancellation"), eq(orderRefunds.status, "failed")))
  const failed = Number(r?.n ?? 0)
  if (failed >= CANCEL_REFUND_ATTEMPTS) return null
  return failed === 0 ? `cancel:${orderRefId}` : `cancel:${orderRefId}:retry${failed}`
}

/**
 * A cancelled order whose payment is still captured: refund what's left. Two cases reach here
 * (markCheckoutPaid and the hourly sweep): the order was cancelled while unpaid and the payment
 * then landed (restock what CHECKOUT's commitHold took), or it was cancelled while paid and the
 * refund is still pending or was declined (the stock decision was made at cancel time and is kept).
 * Returns the id of a refund it actually requested now, else null. Safe to run again.
 */
export async function refundCancelledPaidOrder(tx: Tx, orderRefId: string) {
  const locked = await lockOrder(tx, orderRefId)
  if (!locked) return null
  const { order, state } = locked
  if (state.fulfilmentStatus !== "cancelled" || !CAPTURED.has(state.paymentStatus)) return null
  // An open chargeback: no refund now (it could pay the shopper twice); the sweep retries once it's settled.
  if (state.disputeStatus === "open") return null
  const remaining = state.totalMinor - (await committedRefunds(tx, order.id))
  let refundId: string | null = null
  if (remaining > 0) {
    const k = await cancellationRefundKey(tx, order.id)
    if (!k) {
      log.warn(`[yard] orders: the cancellation refund for ${order.id} was declined ${CANCEL_REFUND_ATTEMPTS} times; Yard's team must refund it by hand`)
    } else {
      const r = await issueRefund(tx, { orderRefId: order.id, amountMinor: remaining, reason: "Order was cancelled before the payment arrived", kind: "cancellation", idempotencyKey: k, actor: SYSTEM })
      if (!r.duplicate && r.refund.status !== "failed") refundId = r.refund.id
    }
  }
  // Restock only what CHECKOUT's commitHold took (after a failed/expired payment the hold was
  // released instead), and never for an order cancelled while paid: cancelOrder already applied
  // the canceller's restock choice (restock:false means the goods are gone).
  if (!state.stockReleased && !(await cancelledWhilePaid(tx, order.id))) await restockLines(tx, order, await linesOf(tx, order.id), null, "Cancelled before payment")
  return refundId
}

/** Whether cancelOrder ran on a captured payment (it recorded `paid` on the order.cancelled event). */
async function cancelledWhilePaid(tx: Tx, orderRefId: string) {
  const [e] = await tx
    .select({ data: orderEvents.data })
    .from(orderEvents)
    .where(and(eq(orderEvents.orderRefId, orderRefId), eq(orderEvents.kind, "order.cancelled")))
    .orderBy(desc(orderEvents.at))
    .limit(1)
  return (e?.data as { paid?: unknown } | undefined)?.paid === true
}
