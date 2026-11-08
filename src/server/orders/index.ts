import "server-only"
import { eq, sql } from "drizzle-orm"
import type { Tx } from "../db"
import { orderRefs } from "../db/schema"
import { orderReturns, orderStates } from "../db/schema/orders-v3"
import { completeDue, hourly, retryCancelledRefunds, syncFulfilmentDue } from "./jobs"
import { expireStaleReturns } from "./returns"

/**
 * ORDERS contract (v3 backend brief). One orders model on shipping's order_refs with separate
 * payment / fulfilment / return / dispute states (order_states), lines, timeline, returns,
 * refunds and disputes (schema/orders-v3.ts).
 *
 * Called by CHECKOUT: createOrdersFromCheckout, markCheckoutPaid, markCheckoutPaymentFailed,
 * handleDisputeEvent, handleRefundOutcome. Called by PAYMENTS/LEDGER: getOrderForMoney.
 * Every function taking `tx` must run inside withTx (PGlite has one connection, §1.3).
 */
export const IMPL: string = "ORDERS-v3-2026-11-08"

export { createOrdersFromCheckout, getOrderForMoney, markCheckoutPaid, markCheckoutPaymentFailed } from "./checkout"
export type { CheckoutGroupInput, CheckoutLineInput, CreateOrdersInput } from "./checkout"
export { handleDisputeEvent, normalizeDisputeEvent, type DisputeEvent } from "./disputes"
export { handleRefundOutcome, issueRefund } from "./refunds"
export { cancelOrder } from "./cancel"
export { requestReturn, cancelReturn, decideReturn, receiveReturn } from "./returns"
export { orderDetail, shopperOrders, brandOrders, checkoutOrders } from "./views"
export { RETURN_WINDOW_DAYS } from "./core"

/**
 * For AUTH's account-deletion job: strips the shopper's personal details from their orders
 * (address beyond country, return notes) while keeping the money records the law requires.
 */
export async function eraseCustomerOrderPii(tx: Tx, customerId: string): Promise<{ orders: number }> {
  const states = await tx
    .update(orderStates)
    .set({ shipTo: sql`jsonb_build_object('country', ${orderStates.shipTo}->>'country')`, updatedAt: new Date() })
    .where(eq(orderStates.customerId, customerId))
    .returning({ id: orderStates.orderRefId })
  await tx.update(orderRefs).set({ shipToCity: null }).where(eq(orderRefs.customerId, customerId))
  await tx.update(orderReturns).set({ note: "" }).where(eq(orderReturns.customerId, customerId))
  return { orders: states.length }
}

/** AUTH erasure hook (src/server/auth/erasure.ts): orders are kept for finance, personal fields go. */
export async function eraseCustomerData(tx: Tx, userId: string): Promise<{ anonymised: number }> {
  const r = await eraseCustomerOrderPii(tx, userId)
  return { anonymised: r.orders }
}

/**
 * Scheduler jobs (src/server/schedulers.ts FeatureModule shape). The orchestrator registers
 * `orders: () => import("./orders")` and `every(13 * MIN, HOUR, () => runFeatureJob("orders", "hourly"))`.
 */
export const jobs = { hourly, completeDue, syncFulfilmentDue, retryCancelledRefunds, expireStaleReturns }
