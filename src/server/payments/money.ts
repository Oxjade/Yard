import "server-only"
import { createHash } from "node:crypto"
import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm"
import { afterCommit, db, inTransaction, withTx, type Tx } from "../db"
import { carts, checkouts, payments, providerEvents, refunds, transfers } from "../db/schema/payments"
import { HttpError } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { getOrderForMoney } from "../orders"
import { applyTransferOutcome, refundOutcome } from "./events"
import { getProvider, ProviderError } from "./providers"

/* ---------- Refunds (PAYMENTS contract) ---------- */

/** A contract refusal (an HttpError 422 'rule', so a route that lets it through answers in plain words). */
export class RefundRefused extends HttpError {
  constructor(message: string) {
    super(422, "rule", message)
    this.name = "RefundRefused"
  }
}

/**
 * PAYMENTS.requestRefund. Idempotent by `idempotencyKey` (the same key returns the same refund;
 * the same key with different details throws). Never refunds more than the order's total or the
 * payment's amount across all non-failed refunds. The provider call runs after the transaction
 * commits; a stub payment (nothing was charged) is refunded at once with provider = 'stub'.
 */
export async function requestRefund(
  tx: Tx,
  input: { paymentId: string; orderId: string; amountMinor: number; currency: string; reason: string; idempotencyKey: string },
): Promise<{ refundId: string; status: "pending" | "succeeded" | "failed" }> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new RefundRefused("Refund amount must be a positive whole number of minor units.")
  const [prior] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey)).limit(1)
  if (prior) {
    if (prior.paymentId !== input.paymentId || prior.orderId !== input.orderId || prior.amountMinor !== input.amountMinor || prior.currency !== input.currency) {
      throw new RefundRefused("This refund key was already used for a different refund.")
    }
    return { refundId: prior.id, status: prior.status as "pending" | "succeeded" | "failed" }
  }

  const [pay] = await tx.select().from(payments).where(eq(payments.id, input.paymentId)).limit(1)
  if (!pay) throw new RefundRefused("That payment doesn't exist.")
  if (pay.status !== "succeeded" && pay.status !== "review") throw new RefundRefused("Only a captured payment can be refunded.")
  if (pay.currency !== input.currency) throw new RefundRefused(`Refunds on this payment are in ${pay.currency}.`)
  const [co] = await tx.select({ orderIds: checkouts.orderIds }).from(checkouts).where(eq(checkouts.id, pay.checkoutId)).limit(1)
  if (!co?.orderIds.includes(input.orderId)) throw new RefundRefused("That order wasn't paid with this payment.")
  const order = await getOrderForMoney(tx, input.orderId)
  if (!order) throw new RefundRefused("That order doesn't exist.")

  const live = and(eq(refunds.paymentId, pay.id), ne(refunds.status, "failed"))
  const [{ paymentTotal }] = await tx.select({ paymentTotal: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint` }).from(refunds).where(live)
  const [{ orderTotal }] = await tx
    .select({ orderTotal: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint` })
    .from(refunds)
    .where(and(live, eq(refunds.orderId, input.orderId)))
  if (Number(orderTotal) + input.amountMinor > order.totalMinor) throw new RefundRefused("That's more than is left to refund on this order.")
  if (Number(paymentTotal) + input.amountMinor > pay.amountMinor) throw new RefundRefused("That's more than is left to refund on this payment.")

  const stub = pay.provider === "stub"
  const refundId = newId("rf")
  await tx.insert(refunds).values({
    id: refundId,
    paymentId: pay.id,
    orderId: input.orderId,
    idempotencyKey: input.idempotencyKey,
    amountMinor: input.amountMinor,
    currency: input.currency,
    reason: input.reason.slice(0, 300),
    provider: stub ? "stub" : "paystack",
    status: stub ? "succeeded" : "pending",
    providerRef: stub ? `stub-${refundId}` : null,
  })
  if (stub) return { refundId, status: "succeeded" }
  afterCommit(() => submitRefund(refundId))
  return { refundId, status: "pending" }
}

/** Sends a pending refund to the provider (outside a transaction). Safe to call repeatedly. */
export async function submitRefund(refundId: string) {
  const d = await db()
  const [rf] = await d.select().from(refunds).where(eq(refunds.id, refundId)).limit(1)
  if (!rf || rf.status !== "pending" || rf.providerRef) return
  const [pay] = await d.select().from(payments).where(eq(payments.id, rf.paymentId)).limit(1)
  if (!pay) return
  await d.update(refunds).set({ attempts: sql`${refunds.attempts} + 1`, updatedAt: new Date() }).where(eq(refunds.id, rf.id))
  try {
    const r = await getProvider().refund({ transactionReference: pay.reference, amountMinor: rf.amountMinor, currency: rf.currency, note: rf.reason })
    await withTx(async (tx) => {
      const [cur] = await tx.select().from(refunds).where(eq(refunds.id, rf.id)).limit(1)
      if (!cur || cur.status !== "pending") return
      await tx.update(refunds).set({ providerRef: r.providerRef || null, status: r.status, failureReason: null, updatedAt: new Date() }).where(eq(refunds.id, rf.id))
      if (r.status !== "pending") await refundOutcome(tx, rf.id, r.status, r.status === "failed" ? "The payment provider declined the refund." : undefined)
    })
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    const definitive = e instanceof ProviderError && e.definitive
    log.warn(`[yard] refund ${rf.id} ${definitive ? "refused" : "not sent"}: ${message}`)
    if (definitive) {
      await withTx(async (tx) => {
        await tx.update(refunds).set({ status: "failed", failureReason: message, updatedAt: new Date() }).where(eq(refunds.id, rf.id))
        await refundOutcome(tx, rf.id, "failed", "The payment provider declined the refund.")
      })
    } else {
      await d.update(refunds).set({ failureReason: message, updatedAt: new Date() }).where(eq(refunds.id, rf.id))
    }
  }
}

/** Job: retries refunds that never reached the provider (up to 6 attempts). */
export async function retryRefunds() {
  const d = await db()
  const due = await d
    .select({ id: refunds.id })
    .from(refunds)
    .where(and(eq(refunds.status, "pending"), isNull(refunds.providerRef), lt(refunds.attempts, 6), lt(refunds.updatedAt, new Date(Date.now() - 5 * 60_000))))
    .limit(50)
  for (const r of due) await submitRefund(r.id)
  return { retried: due.length }
}

/* ---------- Payouts (PAYMENTS contract) ---------- */

/** Paystack transfer reference: lowercase a-z, 0-9, '-', '_', 16–50 chars; deterministic per payout so a retry is the same transfer. */
const transferReference = (payoutId: string) => `yt-${createHash("sha256").update(payoutId).digest("hex").slice(0, 40)}`

/**
 * PAYMENTS.initiatePayout (called OUTSIDE a transaction). Idempotent per payoutId: the transfer
 * row is created once and the provider is called only while it has no provider reference. A
 * provider refusal returns 'failed'; an unknown outcome (timeout) returns 'pending' and the
 * reconcile job verifies it later. Stub: recorded, never sent, always 'pending'.
 */
export async function initiatePayout(input: { payoutId: string; brandId: string; amountMinor: number; currency: string; recipientCode: string }): Promise<{ providerRef: string; status: "pending" | "succeeded" | "failed" }> {
  if (inTransaction()) throw new Error("initiatePayout must be called outside a transaction (it calls the provider)")
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("initiatePayout: amountMinor must be a positive integer")
  const provider = getProvider()
  const reference = transferReference(input.payoutId)
  const d = await db()
  await d
    .insert(transfers)
    .values({ id: newId("tr"), payoutId: input.payoutId, brandId: input.brandId, amountMinor: input.amountMinor, currency: input.currency, recipientCode: input.recipientCode, reference, provider: provider.kind })
    .onConflictDoNothing()
  const [tr] = await d.select().from(transfers).where(eq(transfers.payoutId, input.payoutId)).limit(1)
  if (!tr) throw new Error(`transfer for payout ${input.payoutId} missing`)
  if (tr.amountMinor !== input.amountMinor || tr.currency !== input.currency || tr.brandId !== input.brandId) throw new Error(`payout ${input.payoutId} was already sent with different details`)
  if (tr.providerRef || tr.status !== "pending") return { providerRef: tr.providerRef ?? tr.reference, status: tr.status as "pending" | "succeeded" | "failed" }

  try {
    const r = await provider.transfer({ reference, amountMinor: tr.amountMinor, currency: tr.currency, recipientCode: tr.recipientCode, reason: `Yard payout ${input.payoutId}` })
    await d.update(transfers).set({ providerRef: r.providerRef, failureReason: r.reason, updatedAt: new Date() }).where(eq(transfers.id, tr.id))
    if (r.status !== "pending") await withTx((tx) => applyTransferOutcome(tx, tr.id, r.status === "succeeded" ? "transfer.success" : "transfer.failed", r.providerRef, r.reason))
    return { providerRef: r.providerRef, status: r.status }
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    if (e instanceof ProviderError && e.definitive) {
      await d.update(transfers).set({ status: "failed", failureReason: message, updatedAt: new Date() }).where(eq(transfers.id, tr.id))
      return { providerRef: tr.reference, status: "failed" }
    }
    log.warn(`[yard] payout ${input.payoutId}: transfer outcome unknown (${message}); the reconcile job will verify it`)
    await d.update(transfers).set({ failureReason: message, updatedAt: new Date() }).where(eq(transfers.id, tr.id))
    return { providerRef: tr.reference, status: "pending" }
  }
}

/** Job: verifies live transfers still pending after 15 minutes and applies a final answer. */
export async function reconcileTransfers() {
  const provider = getProvider()
  if (provider.kind !== "paystack") return { checked: 0 }
  const d = await db()
  const due = await d
    .select()
    .from(transfers)
    .where(and(eq(transfers.status, "pending"), eq(transfers.provider, "paystack"), lt(transfers.updatedAt, new Date(Date.now() - 15 * 60_000))))
    .limit(50)
  let settled = 0
  for (const tr of due) {
    try {
      const r = await provider.verifyTransfer(tr.reference)
      if (!r) {
        // Paystack never saw it: send it now (same reference, so no double send).
        if (!tr.providerRef) await initiatePayout({ payoutId: tr.payoutId, brandId: tr.brandId, amountMinor: tr.amountMinor, currency: tr.currency, recipientCode: tr.recipientCode })
        else await d.update(transfers).set({ updatedAt: new Date() }).where(eq(transfers.id, tr.id))
        continue
      }
      if (r.status === "pending") {
        await d.update(transfers).set({ providerRef: r.providerRef, updatedAt: new Date() }).where(eq(transfers.id, tr.id))
        continue
      }
      await withTx((tx) => applyTransferOutcome(tx, tr.id, r.status === "succeeded" ? "transfer.success" : "transfer.failed", r.providerRef, r.reason))
      settled++
    } catch (e) {
      log.warn(`[yard] transfer ${tr.id} verify failed: ${(e as Error).message}`)
    }
  }
  return { checked: due.length, settled }
}

/* ---------- Reads for LEDGER reconciliation ---------- */

/** Captured payments in [from, to): what the ledger's provider-clearing account should match. */
export async function listCapturedPayments(tx: Tx | null, range: { from: Date; to: Date }) {
  const d = tx ?? (await db())
  return d
    .select({ paymentId: payments.id, checkoutId: payments.checkoutId, reference: payments.reference, provider: payments.provider, amountMinor: payments.amountMinor, currency: payments.currency, paidAt: payments.paidAt, status: payments.status })
    .from(payments)
    .where(and(inArray(payments.status, ["succeeded", "review"]), gte(payments.paidAt, range.from), lt(payments.paidAt, range.to)))
}

/** Refunds and transfers updated in [from, to), with their provider status. */
export async function listMoneyMovements(tx: Tx | null, range: { from: Date; to: Date }) {
  const d = tx ?? (await db())
  const [r, t] = await Promise.all([
    d.select().from(refunds).where(and(gte(refunds.updatedAt, range.from), lt(refunds.updatedAt, range.to))),
    d.select().from(transfers).where(and(gte(transfers.updatedAt, range.from), lt(transfers.updatedAt, range.to))),
  ])
  return {
    refunds: r.map((x) => ({ refundId: x.id, paymentId: x.paymentId, orderId: x.orderId, amountMinor: x.amountMinor, currency: x.currency, status: x.status, provider: x.provider, providerRef: x.providerRef })),
    transfers: t.map((x) => ({ transferId: x.id, payoutId: x.payoutId, brandId: x.brandId, amountMinor: x.amountMinor, currency: x.currency, status: x.status, provider: x.provider, providerRef: x.providerRef })),
  }
}

/** The provider-side facts LEDGER's daily reconciliation compares with its postings (see ledger/reconcile.ts ProviderEvent). */
export async function listProviderEventsForReconciliation(input: { from: Date; to: Date }): Promise<{ kind: "charge" | "refund" | "transfer"; ref: string; amountMinor: number; currency: string; status: "succeeded" | "failed" | "pending" | "reversed"; at: Date }[]> {
  const d = await db()
  const [p, r, t] = await Promise.all([
    d.select().from(payments).where(and(gte(payments.updatedAt, input.from), lt(payments.updatedAt, input.to), inArray(payments.status, ["succeeded", "review", "failed"]))),
    d.select().from(refunds).where(and(gte(refunds.updatedAt, input.from), lt(refunds.updatedAt, input.to))),
    d.select().from(transfers).where(and(gte(transfers.updatedAt, input.from), lt(transfers.updatedAt, input.to))),
  ])
  return [
    ...p.map((x) => ({ kind: "charge" as const, ref: x.id, amountMinor: x.amountMinor, currency: x.currency, status: x.status === "failed" ? ("failed" as const) : ("succeeded" as const), at: x.paidAt ?? x.updatedAt })),
    ...r.map((x) => ({ kind: "refund" as const, ref: x.id, amountMinor: x.amountMinor, currency: x.currency, status: x.status as "succeeded" | "failed" | "pending", at: x.updatedAt })),
    ...t.map((x) => ({ kind: "transfer" as const, ref: x.payoutId, amountMinor: x.amountMinor, currency: x.currency, status: x.status as "succeeded" | "failed" | "pending", at: x.updatedAt })),
  ]
}

/* ---------- Account erasure (AUTH hook) ---------- */

/**
 * AUTH's erasure hook. The cart goes; checkouts, payments and refunds are financial records and
 * stay, but the delivery address on each checkout is cut down to the country, and the customer
 * block (email, name, phone) is removed from stored provider event payloads for this customer's
 * payments (the raw body is withheld; processing uses the scrubbed payload).
 */
export async function eraseCustomerData(tx: Tx, userId: string): Promise<{ erased: number; anonymised: number }> {
  const erased = await tx.delete(carts).where(eq(carts.customerId, userId)).returning({ id: carts.id })
  const cos = await tx.select({ id: checkouts.id, shipTo: checkouts.shipTo }).from(checkouts).where(eq(checkouts.customerId, userId))
  for (const c of cos) {
    const country = (c.shipTo as { country?: unknown } | null)?.country
    await tx.update(checkouts).set({ shipTo: { country: typeof country === "string" ? country : null, erased: true }, updatedAt: new Date() }).where(eq(checkouts.id, c.id))
  }
  const refs = await tx.select({ reference: payments.reference }).from(payments).where(eq(payments.customerId, userId))
  let events = 0
  if (refs.length) {
    const rows = await tx
      .update(providerEvents)
      .set({ payload: sql`(${providerEvents.payload} #- '{data,customer}') #- '{data,authorization}'`, rawBody: "[erased]" })
      .where(inArray(providerEvents.subjectRef, refs.map((r) => r.reference)))
      .returning({ id: providerEvents.id })
    events = rows.length
  }
  return { erased: erased.length, anonymised: cos.length + events }
}
