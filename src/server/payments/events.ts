import "server-only"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import { removePurchased } from "../cart"
import { commitHold, releaseHold } from "../catalog"
import { db, withTx, type Tx } from "../db"
import { confirmDropClaims, releaseDropClaims } from "../drops"
import { checkouts, payments, providerEvents, refunds, transfers } from "../db/schema/payments"
import { newId } from "../ids"
import { handleTransferEvent, postPaymentCaptured } from "../ledger"
import { log } from "../log"
import { getOrderForMoney, handleDisputeEvent, handleRefundOutcome, markCheckoutPaid, markCheckoutPaymentFailed } from "../orders"
import { sha256hex } from "../security/crypto"
import { chargeStateFromPaystack } from "./providers"
import { refundEventChange, refundIdFromNote } from "./refund-recovery"

/**
 * Provider events: stored raw first (own transaction, so nothing is lost when processing fails),
 * then processed idempotently in a second transaction. A failed event stays 'failed' with its
 * error until a provider retry or an admin replay processes it again.
 */

type EventRow = typeof providerEvents.$inferSelect
type Payload = { event?: unknown; data?: Record<string, unknown> }

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v))

/** The dedupe key for a provider event: Paystack has no event id, so event + object id + status. */
export function eventKeyOf(payload: Payload, source: "webhook" | "verify" | "simulated") {
  const d = payload.data ?? {}
  const objectId = str(d.id) || str(d.transfer_code) || str(d.reference)
  const base = `${str(payload.event)}:${objectId}:${str(d.status)}`
  // A verify answer and a webhook for the same transaction are the same fact; keep one row each so
  // the reconciliation sees both sources, but dedupe retries within a source.
  return source === "webhook" ? base : `${source}:${base}`
}

function subjectRefOf(payload: Payload): string | null {
  const d = payload.data ?? {}
  const txn = d.transaction as Record<string, unknown> | undefined
  return str(d.reference) || str(d.transaction_reference) || str(txn?.reference) || null
}

/** Stores a raw provider event (or returns the stored one for a retry of the same event). */
export async function recordProviderEvent(input: { provider: "paystack" | "stub"; source: "webhook" | "verify" | "simulated"; payload: Payload; rawBody: string; signatureValid: boolean }): Promise<EventRow> {
  const d = await db()
  const eventKey = eventKeyOf(input.payload, input.source)
  const [row] = await d
    .insert(providerEvents)
    .values({
      id: newId("pe"),
      provider: input.provider,
      source: input.source,
      eventType: str(input.payload.event).slice(0, 80) || "unknown",
      eventKey: eventKey.slice(0, 300),
      bodySha256: sha256hex(input.rawBody),
      rawBody: input.rawBody,
      payload: input.payload,
      signatureValid: input.signatureValid,
      subjectRef: subjectRefOf(input.payload)?.slice(0, 200) ?? null,
    })
    .onConflictDoNothing()
    .returning()
  if (row) return row
  const [existing] = await d
    .select()
    .from(providerEvents)
    .where(and(eq(providerEvents.provider, input.provider), eq(providerEvents.eventKey, eventKey.slice(0, 300))))
    .limit(1)
  return existing
}

export type ProcessResult = { status: "processed" | "ignored" | "failed" | "skipped"; note?: string; error?: string }

/**
 * Processes one stored event. Already processed or ignored → 'skipped' (unless `force`, used by
 * the admin replay: every handler is idempotent, so a forced replay of a processed event is a
 * no-op for anything already applied).
 */
export async function processEvent(eventId: string, opts: { force?: boolean } = {}): Promise<ProcessResult> {
  const d = await db()
  const [ev] = await d.select().from(providerEvents).where(eq(providerEvents.id, eventId)).limit(1)
  if (!ev) return { status: "failed", error: "event not found" }
  if (!opts.force && (ev.status === "processed" || ev.status === "ignored")) return { status: "skipped" }
  try {
    const r = await withTx(async (tx) => {
      const out = await dispatch(tx, ev)
      await tx
        .update(providerEvents)
        .set({ status: out.status, error: out.note ?? null, attempts: sql`${providerEvents.attempts} + 1`, processedAt: new Date() })
        .where(eq(providerEvents.id, ev.id))
      return out
    })
    return r
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500)
    log.error(`[yard] provider event ${ev.id} (${ev.eventType}) failed`, e)
    await d
      .update(providerEvents)
      .set({ status: "failed", error: message, attempts: sql`${providerEvents.attempts} + 1` })
      .where(eq(providerEvents.id, ev.id))
    return { status: "failed", error: message }
  }
}

async function dispatch(tx: Tx, ev: EventRow): Promise<{ status: "processed" | "ignored"; note?: string }> {
  const p = ev.payload as Payload
  const data = (p.data ?? {}) as Record<string, unknown>
  const type = ev.eventType
  switch (type) {
    case "charge.success":
    case "charge.failed": {
      const state = chargeStateFromPaystack(data)
      if (type === "charge.failed" && state.status !== "failed") state.status = "failed"
      if (type === "charge.success" && state.status !== "success") return { status: "ignored", note: `charge.success with status ${str(data.status)}` }
      return applyCharge(tx, state)
    }
    case "refund.processed":
    case "refund.failed":
    case "refund.pending":
    case "refund.processing":
      return applyRefundEvent(tx, type, data)
    case "transfer.success":
    case "transfer.failed":
    case "transfer.reversed":
      return applyTransferEvent(tx, type as TransferType, data)
    case "charge.dispute.create":
    case "charge.dispute.remind":
    case "charge.dispute.resolve":
      return applyDisputeEvent(tx, type, data)
    default:
      return { status: "ignored", note: `unhandled event type ${type}` }
  }
}

/* ---------- Charges ---------- */

type Charge = ReturnType<typeof chargeStateFromPaystack>

/**
 * Applies a final charge outcome to its payment. Success: payment → succeeded, ORDERS
 * markCheckoutPaid, CATALOG commitHold, LEDGER postPaymentCaptured per order, cart cleared,
 * confirmation email. Failure: payment → failed, ORDERS markCheckoutPaymentFailed, hold released.
 * Idempotent, and a payment that succeeded is never turned back into a failure.
 */
export async function applyCharge(tx: Tx, charge: Charge): Promise<{ status: "processed" | "ignored"; note?: string }> {
  if (!charge.reference) return { status: "ignored", note: "no reference" }
  const [pay] = await tx.select().from(payments).where(eq(payments.reference, charge.reference)).limit(1)
  if (!pay) return { status: "ignored", note: `unknown reference ${charge.reference}` }
  const [co] = await tx.select().from(checkouts).where(eq(checkouts.id, pay.checkoutId)).limit(1)
  if (!co) return { status: "ignored", note: "checkout missing" }

  if (charge.status === "failed") {
    if (pay.status === "succeeded" || pay.status === "review") return { status: "ignored", note: `payment already ${pay.status}` }
    if (pay.status === "failed") return { status: "processed", note: "already failed" }
    await tx.update(payments).set({ status: "failed", failureReason: charge.reason?.slice(0, 300) ?? "Payment failed", providerTxnId: charge.providerTxnId, updatedAt: new Date() }).where(eq(payments.id, pay.id))
    if (co.status === "pending_payment") {
      await tx.update(checkouts).set({ status: "failed", failureReason: charge.reason?.slice(0, 300) ?? "Payment failed", updatedAt: new Date() }).where(eq(checkouts.id, co.id))
      await releaseHold(tx, co.holdKey)
      await releaseDropClaims(tx, co.id)
      await markCheckoutPaymentFailed(tx, { checkoutId: co.id, reason: charge.reason?.slice(0, 200) ?? "payment_failed" })
    }
    return { status: "processed" }
  }

  if (charge.status !== "success") return { status: "ignored", note: "not final" }
  if (pay.status === "succeeded") return { status: "processed", note: "already succeeded" }

  // The amount and currency must be exactly what we asked for.
  if (charge.amountMinor !== pay.amountMinor || charge.currency.toUpperCase() !== pay.currency) {
    const note = `amount mismatch: charged ${charge.amountMinor} ${charge.currency}, expected ${pay.amountMinor} ${pay.currency}`
    await tx.update(payments).set({ status: "review", failureReason: note, providerTxnId: charge.providerTxnId, updatedAt: new Date() }).where(eq(payments.id, pay.id))
    await tx.update(checkouts).set({ status: "review", failureReason: "Payment needs review", updatedAt: new Date() }).where(eq(checkouts.id, co.id))
    await writeAudit({ actor: { kind: "system", name: "Yard" }, action: "payment.review", subjectType: "payment", subjectId: pay.id, target: co.id, reason: note })
    log.error(`[yard] ${note} (payment ${pay.id})`)
    return { status: "processed", note }
  }

  const paidAt = charge.paidAt ?? new Date()
  await tx.update(payments).set({ status: "succeeded", paidAt, providerTxnId: charge.providerTxnId, channel: charge.channel, failureReason: null, updatedAt: new Date() }).where(eq(payments.id, pay.id))

  // A payment that lands after the checkout expired or failed: the stock hold was released and
  // ORDERS cancelled the orders. markCheckoutPaid records the capture and ORDERS refunds the
  // cancelled-but-paid orders itself; the captured money still goes through the ledger (the
  // refund posts against it). No stock is committed and the cart is left as it is.
  const late = co.status === "expired" || co.status === "failed"
  const { orderIds } = await markCheckoutPaid(tx, { checkoutId: co.id, paymentId: pay.id, paidAt })
  if (!late) {
    await commitHold(tx, co.holdKey)
    await confirmDropClaims(tx, co.id)
  }
  for (const orderId of orderIds) {
    const o = await getOrderForMoney(tx, orderId)
    if (!o) throw new Error(`order ${orderId} missing after markCheckoutPaid`)
    await postPaymentCaptured(tx, { paymentId: pay.id, orderId, brandId: o.brandId, currency: o.currency, grossMinor: o.totalMinor })
  }
  if (late) {
    const note = "Paid after the checkout ended; the orders were cancelled and are refunded automatically."
    await tx.update(checkouts).set({ paidAt, failureReason: note, updatedAt: new Date() }).where(eq(checkouts.id, co.id))
    await writeAudit({ actor: { kind: "system", name: "Yard" }, action: "payment.late_capture", subjectType: "payment", subjectId: pay.id, target: co.id, reason: note })
    log.warn(`[yard] late capture on ${co.status} checkout ${co.id} (payment ${pay.id}); ORDERS refunds it`)
    return { status: "processed", note: "late capture" }
  }
  await tx.update(checkouts).set({ status: "paid", paidAt, failureReason: null, orderIds: orderIds.length ? orderIds : co.orderIds, updatedAt: new Date() }).where(eq(checkouts.id, co.id))

  // The order confirmation email is sent by ORDERS.markCheckoutPaid.
  const groups = (co.groups ?? []) as { lines: { variantId: string }[] }[]
  await removePurchased(
    tx,
    co.customerId,
    groups.flatMap((g) => g.lines.map((l) => l.variantId)),
  )
  return { status: "processed" }
}

/* ---------- Refunds ---------- */

async function applyRefundEvent(tx: Tx, type: string, data: Record<string, unknown>): Promise<{ status: "processed" | "ignored"; note?: string }> {
  const providerRef = str(data.id)
  let [rf] = providerRef ? await tx.select().from(refunds).where(eq(refunds.providerRef, providerRef)).limit(1) : []
  const noteId = refundIdFromNote(data.merchant_note)
  if (!rf && noteId) [rf] = await tx.select().from(refunds).where(and(eq(refunds.id, noteId), isNull(refunds.providerRef))).limit(1)
  if (!rf) {
    // Fallback: the oldest unmatched refund of that amount on the transaction.
    const txnRef = str(data.transaction_reference) || str((data.transaction as Record<string, unknown> | undefined)?.reference)
    const [pay] = txnRef ? await tx.select().from(payments).where(eq(payments.reference, txnRef)).limit(1) : []
    if (pay) {
      ;[rf] = await tx
        .select()
        .from(refunds)
        .where(and(eq(refunds.paymentId, pay.id), eq(refunds.amountMinor, Number(data.amount ?? -1)), inArray(refunds.status, ["pending"]), isNull(refunds.providerRef)))
        .orderBy(asc(refunds.createdAt))
        .limit(1)
    }
  }
  if (!rf) return { status: "ignored", note: `unknown refund ${providerRef}` }
  const status = type === "refund.processed" ? "succeeded" : type === "refund.failed" ? "failed" : "pending"
  const change = refundEventChange(rf, status, providerRef)
  if (change.kind === "ref") {
    // In progress at the provider: keep its reference so the retry job never sends it again.
    await tx.update(refunds).set({ providerRef: change.providerRef, failureReason: null, updatedAt: new Date() }).where(eq(refunds.id, rf.id))
    return { status: "processed", note: "provider reference recorded" }
  }
  if (change.kind === "none") return { status: "processed", note: "no change" }
  if (change.kind === "ignored") return { status: "ignored", note: `refund already ${rf.status}` }
  await tx
    .update(refunds)
    .set({ status, providerRef: rf.providerRef ?? (providerRef || null), failureReason: status === "failed" ? str(data.reason || data.merchant_note || "Refund failed").slice(0, 300) : null, updatedAt: new Date() })
    .where(eq(refunds.id, rf.id))
  if (status !== "pending") await refundOutcome(tx, rf.id, status, status === "failed" ? "The payment provider couldn't complete the refund." : undefined)
  if (status === "failed") {
    await writeAudit({ actor: { kind: "system", name: "Yard" }, action: "refund.failed", subjectType: "refund", subjectId: rf.id, target: rf.orderId, reason: "Provider reported the refund failed" })
    log.error(`[yard] refund ${rf.id} for order ${rf.orderId} failed at the provider`)
  }
  return { status: "processed" }
}

/**
 * Tells ORDERS the provider's final word on a refund it requested (ORDERS settles the refund,
 * posts LEDGER postRefund and emails the shopper). Not called for the status requestRefund
 * returned synchronously: ORDERS acts on that return value itself.
 */
export async function refundOutcome(tx: Tx, refundId: string, status: "succeeded" | "failed", reason?: string) {
  await handleRefundOutcome(tx, { refundId, status, reason })
}

/* ---------- Transfers ---------- */

type TransferType = "transfer.success" | "transfer.failed" | "transfer.reversed"

async function applyTransferEvent(tx: Tx, type: TransferType, data: Record<string, unknown>): Promise<{ status: "processed" | "ignored"; note?: string }> {
  const reference = str(data.reference)
  const [tr] = reference ? await tx.select().from(transfers).where(eq(transfers.reference, reference)).limit(1) : []
  if (!tr) return { status: "ignored", note: `unknown transfer ${reference}` }
  return applyTransferOutcome(tx, tr.id, type, str(data.transfer_code) || null, str(data.reason) || (type === "transfer.success" ? null : type))
}

/**
 * Updates a transfer and tells LEDGER (handleTransferEvent), once per state change. Shared by the
 * webhook, initiatePayout and the transfer reconcile job. LEDGER matches its payout by our
 * `reference` = the payout id, or by the provider's transfer code.
 */
export async function applyTransferOutcome(tx: Tx, transferId: string, type: TransferType, providerRef: string | null, reason: string | null): Promise<{ status: "processed" | "ignored"; note?: string }> {
  const [tr] = await tx.select().from(transfers).where(eq(transfers.id, transferId)).limit(1)
  if (!tr) return { status: "ignored", note: "transfer missing" }
  const status = type === "transfer.success" ? "succeeded" : "failed"
  if (tr.status === status) return { status: "processed", note: "no change" }
  // A success can still be reversed later (transfer.reversed → failed); a failure is final.
  if (tr.status === "failed") return { status: "ignored", note: "transfer already failed" }
  const ref = providerRef ?? tr.providerRef
  await tx
    .update(transfers)
    .set({ status, providerRef: ref, failureReason: status === "failed" ? (reason?.slice(0, 300) ?? "Transfer failed") : null, updatedAt: new Date() })
    .where(eq(transfers.id, tr.id))
  const r = await handleTransferEvent(tx, { type, reference: tr.payoutId, transferCode: ref, amountMinor: tr.amountMinor, currency: tr.currency, reason })
  if (r.result === "mismatch" || r.result === "ignored") {
    log.error(`[yard] LEDGER did not apply transfer ${tr.id} (${type}) for payout ${tr.payoutId}: ${r.result}`)
    return { status: "processed", note: `ledger: ${r.result}` }
  }
  return { status: "processed" }
}

/* ---------- Disputes ---------- */

/**
 * Disputes go to ORDERS.handleDisputeEvent as the raw Paystack body (ORDERS normalises it),
 * with our payment and checkout ids added to the transaction metadata so it can match orders.
 */
async function applyDisputeEvent(tx: Tx, type: string, data: Record<string, unknown>): Promise<{ status: "processed" | "ignored"; note?: string }> {
  const txn = (data.transaction ?? {}) as Record<string, unknown>
  const reference = str(txn.reference)
  const [pay] = reference ? await tx.select().from(payments).where(eq(payments.reference, reference)).limit(1) : []
  if (!pay) return { status: "ignored", note: `dispute for unknown transaction ${reference}` }
  const meta = (txn.metadata && typeof txn.metadata === "object" ? txn.metadata : {}) as Record<string, unknown>
  const evt = { event: type, data: { ...data, transaction: { ...txn, metadata: { ...meta, paymentId: pay.id, checkoutId: pay.checkoutId } } } }
  const r = await handleDisputeEvent(tx, evt)
  return r.disputeId ? { status: "processed" } : { status: "ignored", note: "ORDERS could not match the dispute" }
}

/* ---------- Reads for admins and LEDGER reconciliation ---------- */

export type ProviderEventSummary = {
  id: string
  provider: string
  source: string
  eventType: string
  status: string
  subjectRef: string | null
  attempts: number
  error: string | null
  signatureValid: boolean
  receivedAt: string
  processedAt: string | null
}

export const toEventSummary = (e: EventRow): ProviderEventSummary => ({
  id: e.id,
  provider: e.provider,
  source: e.source,
  eventType: e.eventType,
  status: e.status,
  subjectRef: e.subjectRef,
  attempts: e.attempts,
  error: e.error,
  signatureValid: e.signatureValid,
  receivedAt: e.receivedAt.toISOString(),
  processedAt: e.processedAt?.toISOString() ?? null,
})

export async function listEvents(q: { status?: string; type?: string; ref?: string; limit: number }) {
  const d = await db()
  const where = and(
    q.status ? eq(providerEvents.status, q.status) : undefined,
    q.type ? eq(providerEvents.eventType, q.type) : undefined,
    q.ref ? eq(providerEvents.subjectRef, q.ref) : undefined,
  )
  const rows = await d.select().from(providerEvents).where(where).orderBy(desc(providerEvents.receivedAt)).limit(q.limit)
  return rows.map(toEventSummary)
}

/**
 * A stored provider payload as admins may see it. Paystack charge data carries the card's reusable
 * `authorization_code` (a token that can charge the card again), card details and the customer's
 * contact details; none of that is needed to read an event, so it is withheld for every role.
 * Card brand, last 4 digits and bank stay, so a payment can still be recognised.
 */
const REDACT_KEYS = new Set(["authorization_code", "signature", "bin", "exp_month", "exp_year", "account_name", "email", "customer_email", "phone", "first_name", "last_name", "international_format_phone", "receiver_bank_account_number", "account_number"])
export function redactProviderPayload(v: unknown, depth = 0): unknown {
  if (depth > 12) return "[redacted]"
  if (Array.isArray(v)) return v.map((x) => redactProviderPayload(x, depth + 1))
  if (!v || typeof v !== "object") return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = REDACT_KEYS.has(k.toLowerCase()) && x !== null && x !== "" ? "[redacted]" : redactProviderPayload(x, depth + 1)
  return out
}

export async function getEvent(id: string) {
  const d = await db()
  const [row] = await d.select().from(providerEvents).where(eq(providerEvents.id, id)).limit(1)
  return row ?? null
}
