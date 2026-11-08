import "server-only"
import { and, count, eq, gt, isNull, lte } from "drizzle-orm"
import { withTx, type Executor, type Tx } from "../db"
import { brands } from "../db/schema"
import { ledgerBrandSettings, ledgerOrderMoney, ledgerTransactions } from "../db/schema/ledger"
import { log } from "../log"
import { ledgerConfig, type BrandTier } from "./config"
import { assertCurrency, bpsOf, brandAccount, isMinor, LedgerError, move, platformAccount, post, type Leg } from "./core"

/**
 * The LEDGER contract postings: payment captured, refund, order completed, and the reserve
 * release job. All take the caller's transaction and are idempotent per business id.
 */

/** The brand's tier: an admin override, else trusted (verified + N completed orders), standard (verified) or new. */
export async function brandTier(tx: Executor, brandId: string): Promise<BrandTier> {
  const [s] = await tx.select({ tier: ledgerBrandSettings.tierOverride }).from(ledgerBrandSettings).where(eq(ledgerBrandSettings.brandId, brandId))
  if (s?.tier) return s.tier as BrandTier
  const [b] = await tx.select({ verified: brands.verified }).from(brands).where(eq(brands.id, brandId))
  if (!b?.verified) return "new"
  const [c] = await tx
    .select({ n: count() })
    .from(ledgerOrderMoney)
    .where(and(eq(ledgerOrderMoney.brandId, brandId), eq(ledgerOrderMoney.status, "completed")))
  return (c?.n ?? 0) >= ledgerConfig.trustedAfterCompletedOrders ? "trusted" : "standard"
}

export async function commissionBpsFor(tx: Executor, brandId: string): Promise<number> {
  const [s] = await tx.select({ bps: ledgerBrandSettings.commissionBpsOverride }).from(ledgerBrandSettings).where(eq(ledgerBrandSettings.brandId, brandId))
  return s?.bps ?? ledgerConfig.commissionBps
}

/**
 * A captured payment for one brand order. Commission (site config, 5%, or the brand's override)
 * goes to platform_commission; the brand's net is split between brand_pending and brand_reserve
 * by tier. Provider clearing is debited with the gross. Idempotent per (paymentId, orderId).
 */
export async function postPaymentCaptured(tx: Tx, input: { paymentId: string; orderId: string; brandId: string; currency: string; grossMinor: number }): Promise<void> {
  assertCurrency(input.currency)
  if (!isMinor(input.grossMinor) || input.grossMinor <= 0) throw new LedgerError("grossMinor must be a positive integer")
  const [already] = await tx.select().from(ledgerOrderMoney).where(eq(ledgerOrderMoney.orderId, input.orderId))
  if (already) {
    if (already.paymentId !== input.paymentId) {
      // A second capture for the same order: never credit the brand twice. Reconciliation reports
      // the extra charge as missing_in_ledger so finance can refund it.
      log.error(`[yard] ledger: order ${input.orderId} already captured by ${already.paymentId}; ignoring capture ${input.paymentId}`)
    }
    return
  }
  const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, input.brandId))
  if (!brand) throw new LedgerError(`unknown brand ${input.brandId}`)

  const commissionBps = await commissionBpsFor(tx, input.brandId)
  const tier = await brandTier(tx, input.brandId)
  const reserveBps = ledgerConfig.reserves[tier].bps
  const commission = Math.min(input.grossMinor, bpsOf(input.grossMinor, commissionBps))
  const net = input.grossMinor - commission
  const reserve = Math.min(net, bpsOf(net, reserveBps))
  const pending = net - reserve
  const c = input.currency

  const legs: Leg[] = [
    { account: platformAccount("provider_clearing", c), direction: "debit", amount: input.grossMinor },
    { account: platformAccount("platform_commission", c), direction: "credit", amount: commission },
    { account: brandAccount(input.brandId, "brand_pending", c), direction: "credit", amount: pending },
    { account: brandAccount(input.brandId, "brand_reserve", c), direction: "credit", amount: reserve },
  ]
  const res = await post(tx, {
    kind: "payment_captured",
    idempotencyKey: `capture:${input.paymentId}:${input.orderId}`,
    currency: c,
    brandId: input.brandId,
    orderId: input.orderId,
    paymentId: input.paymentId,
    memo: "Payment captured",
    legs,
  })
  if (res.duplicate) return
  await tx.insert(ledgerOrderMoney).values({
    orderId: input.orderId,
    brandId: input.brandId,
    currency: c,
    paymentId: input.paymentId,
    grossMinor: input.grossMinor,
    commissionMinor: commission,
    commissionBps,
    tier,
    reserveBps,
    pendingMinor: pending,
    reserveMinor: reserve,
  })
}

/**
 * A refund on a captured order. Commission comes back pro rata (all of what's left on a full
 * refund); the brand's share is taken from the order's pending amount, then its reserve, then the
 * brand's available balance (which may go negative and nets against future sales). Never over-
 * refunds: a refund past the captured gross throws. Idempotent per refundId.
 */
export async function postRefund(tx: Tx, input: { refundId: string; orderId: string; brandId: string; currency: string; amountMinor: number }): Promise<void> {
  assertCurrency(input.currency)
  if (!isMinor(input.amountMinor) || input.amountMinor <= 0) throw new LedgerError("amountMinor must be a positive integer")
  const [om] = await tx.select().from(ledgerOrderMoney).where(eq(ledgerOrderMoney.orderId, input.orderId)).for("update")
  if (!om) throw new LedgerError(`order ${input.orderId} has no captured payment in the ledger`)
  if (om.brandId !== input.brandId) throw new LedgerError("refund brand doesn't match the order")
  if (om.currency !== input.currency) throw new LedgerError("refund currency doesn't match the order")

  // Idempotency first, so a replay after a full refund is a no-op rather than an over-refund error.
  const key = `refund:${input.refundId}`
  const [dup] = await tx.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, key))
  if (dup) return

  const remaining = om.grossMinor - om.refundedMinor
  if (input.amountMinor > remaining) throw new LedgerError(`refund ${input.amountMinor} exceeds the refundable ${remaining}`)
  const full = input.amountMinor === remaining
  const commissionLeft = om.commissionMinor - om.commissionRefundedMinor
  const commissionBack = full ? commissionLeft : Math.min(commissionLeft, Math.round((input.amountMinor * om.commissionMinor) / om.grossMinor))
  const brandShare = input.amountMinor - commissionBack
  const fromPending = Math.min(om.pendingMinor, brandShare)
  const fromReserve = Math.min(om.reserveReleasedAt ? 0 : om.reserveMinor, brandShare - fromPending)
  const fromAvailable = brandShare - fromPending - fromReserve
  const c = input.currency

  await post(tx, {
    kind: "refund",
    idempotencyKey: key,
    currency: c,
    brandId: om.brandId,
    orderId: om.orderId,
    paymentId: om.paymentId,
    refundId: input.refundId,
    memo: full ? "Full refund" : "Partial refund",
    legs: [
      { account: platformAccount("platform_commission", c), direction: "debit", amount: commissionBack },
      { account: brandAccount(om.brandId, "brand_pending", c), direction: "debit", amount: fromPending },
      { account: brandAccount(om.brandId, "brand_reserve", c), direction: "debit", amount: fromReserve },
      { account: brandAccount(om.brandId, "brand_available", c), direction: "debit", amount: fromAvailable },
      { account: platformAccount("provider_clearing", c), direction: "credit", amount: input.amountMinor },
    ],
  })
  await tx
    .update(ledgerOrderMoney)
    .set({
      refundedMinor: om.refundedMinor + input.amountMinor,
      commissionRefundedMinor: om.commissionRefundedMinor + commissionBack,
      pendingMinor: om.pendingMinor - fromPending,
      reserveMinor: om.reserveMinor - fromReserve,
      status: full ? "refunded" : om.status,
    })
    .where(eq(ledgerOrderMoney.orderId, om.orderId))
}

/**
 * The order's return window has closed: its pending share becomes available, and its reserve (if
 * any) is scheduled for release after the tier's reserve period. No-op when the order was never
 * captured, is already completed, or was fully refunded.
 */
export async function postOrderCompleted(tx: Tx, input: { orderId: string; brandId: string }): Promise<void> {
  const [om] = await tx.select().from(ledgerOrderMoney).where(eq(ledgerOrderMoney.orderId, input.orderId)).for("update")
  if (!om) {
    log.warn(`[yard] ledger: postOrderCompleted for ${input.orderId}, which has no captured payment; nothing to move`)
    return
  }
  if (om.brandId !== input.brandId) throw new LedgerError("completion brand doesn't match the order")
  if (om.status !== "captured") return
  const now = new Date()
  await post(tx, {
    kind: "order_completed",
    idempotencyKey: `complete:${om.orderId}`,
    currency: om.currency,
    brandId: om.brandId,
    orderId: om.orderId,
    paymentId: om.paymentId,
    memo: "Return window closed",
    legs: move(brandAccount(om.brandId, "brand_pending", om.currency), brandAccount(om.brandId, "brand_available", om.currency), om.pendingMinor),
  })
  const days = ledgerConfig.reserves[om.tier as BrandTier]?.days ?? 0
  await tx
    .update(ledgerOrderMoney)
    .set({
      status: "completed",
      completedAt: now,
      pendingMinor: 0,
      reserveReleaseAt: om.reserveMinor > 0 ? new Date(now.getTime() + days * 86_400_000) : null,
      reserveReleasedAt: om.reserveMinor > 0 ? null : now,
    })
    .where(eq(ledgerOrderMoney.orderId, om.orderId))
}

/** Job: releases reserves whose hold period has passed (reserve → available), 200 orders per run, one transaction each. */
export async function releaseDueReserves(now = new Date()): Promise<{ released: number }> {
  const due = await withTx(async (tx) =>
    tx
      .select({ orderId: ledgerOrderMoney.orderId })
      .from(ledgerOrderMoney)
      .where(and(gt(ledgerOrderMoney.reserveMinor, 0), isNull(ledgerOrderMoney.reserveReleasedAt), lte(ledgerOrderMoney.reserveReleaseAt, now)))
      .limit(200),
  )
  let released = 0
  for (const { orderId } of due) {
    await withTx(async (tx) => {
      const [om] = await tx.select().from(ledgerOrderMoney).where(eq(ledgerOrderMoney.orderId, orderId)).for("update")
      if (!om || om.reserveReleasedAt || om.reserveMinor <= 0) return
      await post(tx, {
        kind: "reserve_released",
        idempotencyKey: `reserve:${om.orderId}`,
        currency: om.currency,
        brandId: om.brandId,
        orderId: om.orderId,
        memo: "Reserve released",
        legs: move(brandAccount(om.brandId, "brand_reserve", om.currency), brandAccount(om.brandId, "brand_available", om.currency), om.reserveMinor),
      })
      await tx.update(ledgerOrderMoney).set({ reserveMinor: 0, reserveReleasedAt: now }).where(eq(ledgerOrderMoney.orderId, om.orderId))
      released++
    })
  }
  return { released }
}
