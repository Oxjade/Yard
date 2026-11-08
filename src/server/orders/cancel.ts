import "server-only"
import { eq, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import { restock } from "../catalog"
import type { Tx } from "../db"
import { orderLines } from "../db/schema/orders-v3"
import { conflict, notFound, rule } from "../http/errors"
import { addEvent, announce, committedRefunds, deriveFulfilment, linesOf, lockOrder, setMerchantStatus, shipmentEventsFor, SYSTEM, updateState, type OrderActor, type OrderLineRow, type OrderRefRow } from "./core"
import { issueRefund } from "./refunds"

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
  await addEvent(tx, order.id, "order.cancelled", input.actor, { by })

  let refundId: string | null = null
  if (CAPTURED.has(state.paymentStatus)) {
    const remaining = state.totalMinor - (await committedRefunds(tx, order.id))
    if (remaining > 0) {
      const r = await issueRefund(tx, { orderRefId: order.id, amountMinor: remaining, reason: "Order cancelled before dispatch", kind: "cancellation", idempotencyKey: `cancel:${order.id}`, actor: input.actor })
      refundId = r.refund.id
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
  await announce(order, "cancelled")
  return { orderId: order.id, alreadyCancelled: false, refundId }
}

/**
 * An order cancelled while unpaid whose payment then landed: refund what's left and restock what
 * CHECKOUT's commitHold took. Safe to run again (the refund is keyed per order).
 */
export async function refundCancelledPaidOrder(tx: Tx, orderRefId: string) {
  const locked = await lockOrder(tx, orderRefId)
  if (!locked) return null
  const { order, state } = locked
  if (state.fulfilmentStatus !== "cancelled" || !CAPTURED.has(state.paymentStatus)) return null
  const remaining = state.totalMinor - (await committedRefunds(tx, order.id))
  let refundId: string | null = null
  if (remaining > 0) {
    const r = await issueRefund(tx, { orderRefId: order.id, amountMinor: remaining, reason: "Order was cancelled before the payment arrived", kind: "cancellation", idempotencyKey: `cancel:${order.id}`, actor: SYSTEM })
    refundId = r.refund.id
  }
  // Restock only what CHECKOUT's commitHold took: after a failed/expired payment the hold was released instead.
  if (!state.stockReleased) await restockLines(tx, order, await linesOf(tx, order.id), null, "Cancelled before payment")
  return refundId
}
