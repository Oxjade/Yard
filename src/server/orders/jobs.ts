import "server-only"
import { and, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm"
import { db, withTx, type Tx } from "../db"
import { orderRefs } from "../db/schema"
import { orderRefunds, orderReturns, orderStates } from "../db/schema/orders-v3"
import { postOrderCompleted } from "../ledger"
import { log } from "../log"
import { refundCancelledPaidOrder } from "./cancel"
import { addEvent, announce, lockOrder, SYSTEM, syncFulfilment, updateState } from "./core"
import { expireStaleReturns } from "./returns"

const BATCH = 200

/**
 * Hourly: brings stored fulfilment up to date with shipping's events (delivered → the return
 * window starts) for open, paid orders. Reads stay live either way; this keeps filters and the
 * completion job right.
 */
export async function syncFulfilmentDue(only?: string[]) {
  if (only && !only.length) return { checked: 0, changed: 0 }
  const d = await db()
  const rows = await d
    .select({ id: orderStates.orderRefId })
    .from(orderStates)
    .innerJoin(orderRefs, eq(orderRefs.id, orderStates.orderRefId))
    .where(and(isNull(orderStates.completedAt), notInArray(orderStates.fulfilmentStatus, ["delivered", "cancelled", "returned_to_sender"]), inArray(orderStates.paymentStatus, ["paid", "partially_refunded"]), inArray(orderRefs.status, ["shipped", "delivered", "refund_requested"]), only ? inArray(orderStates.orderRefId, only) : undefined))
    .limit(500)
  let changed = 0
  for (const r of rows) {
    await withTx(async (tx) => {
      const locked = await lockOrder(tx, r.id)
      if (!locked) return
      const before = locked.state.fulfilmentStatus
      const { state } = await syncFulfilment(tx, locked.order, locked.state)
      if (state.fulfilmentStatus !== before) {
        changed++
        await addEvent(tx, r.id, `fulfilment.${state.fulfilmentStatus}`, SYSTEM, {})
      }
    })
  }
  return { checked: rows.length, changed }
}

async function hasPendingRefund(tx: Tx, orderRefId: string) {
  const [r] = await tx
    .select({ id: orderRefunds.id })
    .from(orderRefunds)
    .where(and(eq(orderRefunds.orderRefId, orderRefId), eq(orderRefunds.status, "pending")))
    .limit(1)
  return !!r
}

async function hasOpenReturn(tx: Tx, orderRefId: string) {
  const [r] = await tx
    .select({ id: orderReturns.id })
    .from(orderReturns)
    .where(and(eq(orderReturns.orderRefId, orderRefId), inArray(orderReturns.status, ["requested", "approved"])))
    .limit(1)
  return !!r
}

/**
 * Hourly: orders past their return window with nothing open (no return, no pending refund, no
 * open dispute) complete: LEDGER postOrderCompleted moves the brand's money from pending to
 * available. Cancelled orders close once their refunds have settled (paid ones through the ledger
 * too; unpaid ones have nothing to settle).
 */
export async function completeDue(now = Date.now(), only?: string[]) {
  if (only && !only.length) return { checked: 0, completed: 0 }
  const d = await db()
  const at = new Date(now)
  const due = await d
    .select({ id: orderStates.orderRefId })
    .from(orderStates)
    .where(
      and(
        isNull(orderStates.completedAt),
        sql`${orderStates.disputeStatus} <> 'open'`,
        notInArray(orderStates.returnStatus, ["requested", "approved"]),
        or(
          and(lt(orderStates.returnWindowEndsAt, at), inArray(orderStates.paymentStatus, ["paid", "partially_refunded", "refunded"]), sql`${orderStates.fulfilmentStatus} <> 'cancelled'`),
          eq(orderStates.fulfilmentStatus, "cancelled"),
        ),
        only ? inArray(orderStates.orderRefId, only) : undefined,
      ),
    )
    .limit(BATCH)
  let completed = 0
  for (const r of due) {
    try {
      await withTx(async (tx) => {
        const locked = await lockOrder(tx, r.id)
        if (!locked || locked.state.completedAt) return
        const { order } = locked
        // The stored window may predate the rule that it runs from when the delivery was recorded: re-derive it first.
        const state = locked.state.fulfilmentStatus === "cancelled" ? locked.state : (await syncFulfilment(tx, order, locked.state)).state
        if (state.disputeStatus === "open" || (await hasOpenReturn(tx, order.id)) || (await hasPendingRefund(tx, order.id))) return
        const cancelled = state.fulfilmentStatus === "cancelled"
        const captured = ["paid", "partially_refunded", "refunded"].includes(state.paymentStatus)
        if (cancelled && captured && state.paymentStatus !== "refunded") return // the cancellation refund is still owed (sweep below)
        if (!cancelled && (!state.returnWindowEndsAt || state.returnWindowEndsAt.getTime() >= now)) return
        if (captured) await postOrderCompleted(tx, { orderId: order.id, brandId: order.brandId })
        await updateState(tx, order.id, { completedAt: new Date() })
        await addEvent(tx, order.id, "order.completed", SYSTEM, { settled: captured })
        await announce(order, "completed")
        completed++
      })
    } catch (e) {
      log.error(`[yard] orders: completing ${r.id} failed`, e)
    }
  }
  return { checked: due.length, completed }
}

/** Hourly: cancelled orders whose payment landed but whose refund isn't recorded yet. */
export async function retryCancelledRefunds(only?: string[]) {
  if (only && !only.length) return { checked: 0, refunded: 0 }
  const d = await db()
  const rows = await d
    .select({ id: orderStates.orderRefId })
    .from(orderStates)
    .where(and(eq(orderStates.fulfilmentStatus, "cancelled"), inArray(orderStates.paymentStatus, ["paid", "partially_refunded"]), isNull(orderStates.completedAt), only ? inArray(orderStates.orderRefId, only) : undefined))
    .limit(BATCH)
  let refunded = 0
  for (const r of rows) {
    try {
      const id = await withTx((tx) => refundCancelledPaidOrder(tx, r.id))
      if (id) refunded++
    } catch (e) {
      log.error(`[yard] orders: cancellation refund for ${r.id} failed`, e)
    }
  }
  return { checked: rows.length, refunded }
}

/** The scheduler entry (§1.3 FeatureModule.jobs): one hourly run of everything above. */
export async function hourly(opts: { now?: number; only?: string[] } = {}) {
  const sync = await syncFulfilmentDue(opts.only)
  const retried = await retryCancelledRefunds(opts.only)
  const returns = await expireStaleReturns(opts.now, opts.only)
  const done = await completeDue(opts.now, opts.only)
  if (sync.changed + retried.refunded + returns.expired + done.completed) {
    log.info(`[yard] orders: ${sync.changed} fulfilment updates, ${retried.refunded} cancellation refunds, ${returns.expired} returns expired, ${done.completed} orders completed`)
  }
  return { sync, retried, returns, done }
}
