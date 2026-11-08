import "server-only"
import { and, eq, or } from "drizzle-orm"
import type { CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { writeAudit } from "../audit"
import type { Tx } from "../db"
import { orderRefunds, type REFUND_KINDS } from "../db/schema/orders-v3"
import { postRefund } from "../ledger"
import { conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { requestRefund } from "../payments"
import { addEvent, announce, committedRefunds, emailCustomer, lockOrder, orderUrl, setMerchantStatus, updateState, type OrderActor, type OrderRefRow, type OrderStateRow } from "./core"

export type RefundRow = typeof orderRefunds.$inferSelect

export function money(amountMinor: number, currency: string) {
  try {
    return formatMoney(amountMinor, currency as CurrencyCode)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency}`
  }
}

export type IssueRefundInput = {
  orderRefId: string
  amountMinor: number
  reason: string
  kind: (typeof REFUND_KINDS)[number]
  /** Unique per order: the same key returns the same refund (no second request to the provider). */
  idempotencyKey: string
  actor: OrderActor
  returnId?: string | null
  disputeId?: string | null
  /** A dispute the provider already settled against Yard: recorded as succeeded, nothing is requested. */
  providerTaken?: boolean
  /** Brand scoping: refuse when the order isn't this brand's (404). */
  brandId?: string
}

const CAPTURED = new Set(["paid", "partially_refunded"])
export const DISPUTE_OPEN_REFUND = "This order's payment is disputed with the bank, so no refund can be sent until the dispute is settled. Yard's team is handling it."

/**
 * The one way money goes back on an order (§ORDERS). Under the order's row lock:
 * idempotent per (order, key) → captured payment required → pending + succeeded refunds never
 * exceed the total → a pending row → PAYMENTS requestRefund → LEDGER postRefund once it
 * succeeds (now, or later through handleRefundOutcome from the provider webhook).
 */
export async function issueRefund(tx: Tx, input: IssueRefundInput): Promise<{ refund: RefundRow; duplicate: boolean }> {
  const locked = await lockOrder(tx, input.orderRefId)
  if (!locked || (input.brandId && locked.order.brandId !== input.brandId)) throw notFound()
  const { order, state } = locked

  const [existing] = await tx
    .select()
    .from(orderRefunds)
    .where(and(eq(orderRefunds.orderRefId, order.id), eq(orderRefunds.idempotencyKey, input.idempotencyKey)))
    .limit(1)
  if (existing) {
    // Same key, different request from a person: they must not believe the new amount was applied.
    // (System/provider replays recompute their amount from what is already refunded, so they keep plain replay.)
    const person = input.actor.kind === "shopper" || input.actor.kind === "brand" || input.actor.kind === "admin"
    if (person && (existing.amountMinor !== input.amountMinor || existing.kind !== input.kind)) throw conflict("That idempotency key was already used for a different refund. Use a new key for a new refund.")
    return { refund: existing, duplicate: true }
  }

  // An open chargeback: the provider may take the full amount back, so sending a refund too would
  // pay the shopper twice. Only the provider's own settlement of the dispute is recorded.
  if (state.disputeStatus === "open" && !input.providerTaken) throw conflict(DISPUTE_OPEN_REFUND)
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw rule("A refund must be more than zero.")
  if (!CAPTURED.has(state.paymentStatus)) {
    throw rule(state.paymentStatus === "refunded" ? "This order has already been refunded in full." : "This order has no captured payment, so there is nothing to refund.")
  }
  if (!input.providerTaken && !state.paymentId) throw rule("This order's payment isn't on record with the payment provider, so Yard can't refund it automatically.")

  const refundable = state.totalMinor - (await committedRefunds(tx, order.id))
  if (refundable <= 0) throw rule("Everything paid on this order is already refunded or being refunded.")
  if (input.amountMinor > refundable) throw rule(`At most ${money(refundable, state.currency)} can still be refunded on this order.`)

  const id = newId("orf")
  const [row] = await tx
    .insert(orderRefunds)
    .values({
      id,
      orderRefId: order.id,
      brandId: order.brandId,
      returnId: input.returnId ?? null,
      disputeId: input.disputeId ?? null,
      kind: input.kind,
      status: "pending",
      amountMinor: input.amountMinor,
      currency: state.currency,
      reason: input.reason.slice(0, 200),
      idempotencyKey: input.idempotencyKey,
      requestedByKind: input.actor.kind,
      requestedBy: input.actor.id,
    })
    .returning()
  await addEvent(tx, order.id, "refund.requested", input.actor, { refundId: id, kind: input.kind, amountMinor: input.amountMinor, currency: state.currency })

  let refund = row
  if (input.providerTaken) {
    refund = await settleRefund(tx, refund, order, state, input.actor)
  } else {
    let r: Awaited<ReturnType<typeof requestRefund>>
    try {
      r = await requestRefund(tx, { paymentId: state.paymentId!, orderId: order.id, amountMinor: input.amountMinor, currency: state.currency, reason: input.reason.slice(0, 200), idempotencyKey: `order-refund:${id}` })
    } catch (e) {
      // PAYMENTS refuses with a RefundRefused (its own cap, an unknown payment): a 422 for people; the whole write rolls back.
      if (e instanceof Error && e.name === "RefundRefused") throw rule(e.message)
      throw e
    }
    const [withRef] = await tx.update(orderRefunds).set({ paymentRefundId: r.refundId }).where(eq(orderRefunds.id, id)).returning()
    refund = withRef
    if (r.status === "succeeded") refund = await settleRefund(tx, refund, order, state, input.actor)
    else if (r.status === "failed") refund = await failRefund(tx, refund, order, "The payment provider declined the refund.")
    else await setMerchantStatusForPending(tx, order)
  }

  if (input.actor.kind === "brand" || input.actor.kind === "admin") {
    await writeAudit({
      actor: { kind: input.actor.kind, id: input.actor.id, name: input.actor.name, role: input.actor.role },
      action: "order.refund_issued",
      target: `Order ${order.reference}`,
      subjectType: "order_refund",
      subjectId: id,
      brandId: order.brandId,
      meta: { orderId: order.id, kind: input.kind, amountMinor: input.amountMinor, currency: state.currency, status: refund.status, returnId: input.returnId ?? null },
    })
  }
  await announce(order, "refund")
  return { refund, duplicate: false }
}

/** A pending refund on a delivered order reads "refund requested" to shipping and Studio. */
async function setMerchantStatusForPending(tx: Tx, order: OrderRefRow) {
  if (order.status === "delivered" || order.status === "shipped") await setMerchantStatus(tx, order.id, "refund_requested")
}

/** Marks a refund succeeded, posts it to the ledger once, and moves the order's payment state. */
async function settleRefund(tx: Tx, refund: RefundRow, order: OrderRefRow, state: OrderStateRow, actor: OrderActor): Promise<RefundRow> {
  if (refund.status === "succeeded" && refund.ledgerPostedAt) return refund
  await postRefund(tx, { refundId: refund.paymentRefundId ?? refund.id, orderId: order.id, brandId: order.brandId, currency: refund.currency, amountMinor: refund.amountMinor })
  const now = new Date()
  const [settled] = await tx.update(orderRefunds).set({ status: "succeeded", settledAt: now, ledgerPostedAt: now }).where(eq(orderRefunds.id, refund.id)).returning()
  const refunded = Math.min(state.totalMinor, state.refundedMinor + refund.amountMinor)
  const full = refunded >= state.totalMinor
  await updateState(tx, order.id, { refundedMinor: refunded, paymentStatus: full ? "refunded" : "partially_refunded" })
  if (full && order.status !== "cancelled") await setMerchantStatus(tx, order.id, "refunded")
  else if (!full && order.status === "refund_requested") await setMerchantStatus(tx, order.id, state.fulfilmentStatus === "delivered" ? "delivered" : state.fulfilmentStatus === "shipped" ? "shipped" : "paid")
  await addEvent(tx, order.id, "refund.succeeded", actor, { refundId: refund.id, amountMinor: refund.amountMinor, currency: refund.currency, full })
  await emailCustomer(tx, order.customerId, "refund", { reference: order.reference, amount: money(refund.amountMinor, refund.currency), amountMinor: refund.amountMinor, currency: refund.currency, full: full ? 1 : 0, url: orderUrl(order.id) }, `order-refund:${refund.id}`)
  return settled
}

async function failRefund(tx: Tx, refund: RefundRow, order: OrderRefRow, reason: string): Promise<RefundRow> {
  const [failed] = await tx.update(orderRefunds).set({ status: "failed", failureReason: reason, settledAt: new Date() }).where(eq(orderRefunds.id, refund.id)).returning()
  await addEvent(tx, order.id, "refund.failed", { kind: "provider", id: null }, { refundId: refund.id, amountMinor: refund.amountMinor })
  if (order.status === "refund_requested") {
    const [stillPending] = await tx
      .select({ id: orderRefunds.id })
      .from(orderRefunds)
      .where(and(eq(orderRefunds.orderRefId, order.id), eq(orderRefunds.status, "pending")))
      .limit(1)
    if (!stillPending) await setMerchantStatus(tx, order.id, "delivered")
  }
  return failed
}

/**
 * The provider's final word on a refund (PAYMENTS/CHECKOUT call this from the refund.processed /
 * refund.failed webhook). `refundId` is PAYMENTS' refund id (what requestRefund returned); Yard's
 * own `rf_*` id works too. Idempotent: a repeat of the same outcome changes nothing.
 */
export async function handleRefundOutcome(tx: Tx, input: { refundId: string; status: "succeeded" | "failed"; reason?: string }): Promise<{ orderId: string | null; changed: boolean }> {
  const [found] = await tx
    .select()
    .from(orderRefunds)
    .where(or(eq(orderRefunds.paymentRefundId, input.refundId), eq(orderRefunds.id, input.refundId)))
    .limit(1)
  if (!found) return { orderId: null, changed: false }
  const locked = await lockOrder(tx, found.orderRefId)
  if (!locked) return { orderId: null, changed: false }
  const [refund] = await tx.select().from(orderRefunds).where(eq(orderRefunds.id, found.id)).limit(1)
  if (input.status === "succeeded") {
    if (refund.status === "succeeded") return { orderId: refund.orderRefId, changed: false }
    if (refund.status === "failed") log.warn(`[yard] orders: refund ${refund.id} was reported failed, now succeeded; settling it`)
    await settleRefund(tx, refund, locked.order, locked.state, { kind: "provider", id: null })
  } else {
    if (refund.status !== "pending") {
      if (refund.status === "succeeded") log.warn(`[yard] orders: refund ${refund.id} succeeded earlier but the provider now reports it failed; leaving the ledger as posted for finance to review`)
      return { orderId: refund.orderRefId, changed: false }
    }
    await failRefund(tx, refund, locked.order, (input.reason ?? "The payment provider couldn't complete the refund.").slice(0, 200))
    await writeAudit({ actor: { kind: "system", name: "Payment provider" }, action: "order.refund_failed", target: `Order ${locked.order.reference}`, subjectType: "order_refund", subjectId: refund.id, brandId: locked.order.brandId, meta: { orderId: locked.order.id, amountMinor: refund.amountMinor, currency: refund.currency } })
  }
  await announce(locked.order, "refund")
  return { orderId: refund.orderRefId, changed: true }
}
