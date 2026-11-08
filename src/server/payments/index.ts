import "server-only"
import { purgeStaleCarts } from "../cart"
import { expireCheckouts } from "./checkout"
import { reconcileTransfers, retryRefunds } from "./money"

/**
 * PAYMENTS contract (v3, CHECKOUT area). Cart, checkout, Paystack payments, refunds, transfers and
 * provider webhooks. Provider: Paystack when PAYSTACK_SECRET_KEY is set, otherwise the STUB
 * (never charges, never reports success by itself).
 *
 * Contract for other areas:
 *  - requestRefund(tx, …)   — ORDERS, inside its refund transaction; the provider call runs after commit.
 *  - initiatePayout(…)      — LEDGER, outside any transaction.
 * Extra: listProviderEventsForReconciliation (LEDGER reconcile), listCapturedPayments, listMoneyMovements,
 * listEvents, eraseCustomerData (AUTH erasure hook).
 */
export const IMPL: string = "CHECKOUT-v3-2026-11-08"

export { requestRefund, initiatePayout, RefundRefused, listCapturedPayments, listMoneyMovements, listProviderEventsForReconciliation, eraseCustomerData } from "./money"
export { listEvents } from "./events"
export { paymentsConfig } from "./config"

/**
 * Scheduled jobs (the orchestrator registers them in src/server/schedulers.ts):
 *  - payments.expireCheckouts   every 5 min
 *  - payments.retryRefunds      every 15 min
 *  - payments.reconcileTransfers every 30 min
 *  - payments.purgeStaleCarts   daily
 */
export const jobs = {
  expireCheckouts: () => expireCheckouts(),
  retryRefunds,
  reconcileTransfers,
  purgeStaleCarts,
}
