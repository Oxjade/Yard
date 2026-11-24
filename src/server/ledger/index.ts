import "server-only"
import { log } from "../log"
import { payoutReminders as sendPayoutReminders } from "./payout-needed"
import { releaseDueReserves } from "./postings"
import { runReconciliation } from "./reconcile"

/**
 * LEDGER contract (backend v3): the double-entry ledger, balances, payouts and reconciliation.
 *
 * Contract postings (take the caller's transaction, idempotent):
 *   postPaymentCaptured(tx, { paymentId, orderId, brandId, currency, grossMinor, courierShippingMinor? })
 *   postCourierBooked(tx, { shipmentId, orderId, brandId, currency, costMinor })   (docs/SHIPPING.md)
 *   postRefund(tx, { refundId, orderId, brandId, currency, amountMinor })
 *   postOrderCompleted(tx, { orderId, brandId })
 * Provider outcome handler for CHECKOUT's webhook:
 *   handleTransferEvent(tx, evt)
 */
export const IMPL: string = "LEDGER-v3-2026-11-08"

export { postPaymentCaptured, postRefund, postOrderCompleted, postCourierBooked, brandTier } from "./postings"
export { handleTransferEvent, type TransferEvent } from "./payouts"
export { brandBalances, type BrandBalanceDto, type PayoutDto, type PayoutAccountDto, type StatementEntryDto } from "./read"
export { runReconciliation, type ProviderEvent } from "./reconcile"
export { LedgerError } from "./core"

/** Daily (after UTC midnight): releases reserves past their hold period. */
async function releaseReserves() {
  const r = await releaseDueReserves()
  if (r.released) log.info(`[yard] ledger: released ${r.released} reserves`)
}

/** Daily: ledger vs itself and vs provider events. */
async function reconcileDaily() {
  await runReconciliation({ triggeredBy: "system" })
}

/** Hourly: the one "add your payout account" reminder, 3 days after a brand's first sale without one. */
async function payoutReminders() {
  await sendPayoutReminders()
}

/** For src/server/schedulers.ts (FeatureModule shape): register `ledger: () => import("./ledger")`. */
export const jobs = { releaseReserves, reconcileDaily, payoutReminders }
