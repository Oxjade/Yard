import "server-only"
import { and, desc, eq, inArray, or, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import type { Executor, Tx } from "../db"
import { orderRefs } from "../db/schema"
import { orderDisputes, orderStates, type DISPUTE_STATES } from "../db/schema/orders-v3"
import { conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { addEvent, announce, assertAmbientTx, committedRefunds, lockOrder, updateState, type OrderActor } from "./core"
import { issueRefund } from "./refunds"

export type DisputeRow = typeof orderDisputes.$inferSelect
type DisputeState = (typeof DISPUTE_STATES)[number]

/**
 * A provider dispute event in Yard's terms. CHECKOUT may pass either this, or the raw Paystack
 * webhook body (`{ event: "charge.dispute.create" | "charge.dispute.remind" | "charge.dispute.resolve", data }`),
 * which is normalised here.
 */
export type DisputeEvent = {
  provider: string
  /** The provider's event id (or a hash of the raw body) for the record; processing is idempotent by state. */
  providerEventId?: string | null
  type: "opened" | "updated" | "resolved"
  providerDisputeId: string
  paymentId?: string | null
  /** The provider transaction reference / id: matched against order_states.payment_id. */
  transactionRef?: string | null
  checkoutId?: string | null
  status?: DisputeState
  resolution?: "won" | "lost" | null
  /** Minor units the provider took back on a loss (defaults to the disputed amount). */
  refundMinor?: number | null
  amountMinor?: number | null
  currency?: string | null
  category?: string | null
  evidenceDueAt?: Date | null
}

const str = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null)
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null)
const date = (v: unknown) => {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Paystack's dispute statuses → Yard's. */
function paystackStatus(s: string | null, resolution: string | null): DisputeState {
  if (resolution === "merchant-accepted") return "lost"
  if (resolution === "declined") return "won"
  switch (s) {
    case "awaiting-merchant-feedback":
      return "awaiting_response"
    case "awaiting-bank-feedback":
    case "pending":
      return "under_review"
    case "archived":
    case "resolved":
      return "closed"
    default:
      return "open"
  }
}

export function normalizeDisputeEvent(evt: unknown): DisputeEvent | null {
  if (!evt || typeof evt !== "object") return null
  const e = evt as Record<string, unknown>
  if (typeof e.providerDisputeId === "string" && typeof e.type === "string") return e as unknown as DisputeEvent
  // Raw Paystack body.
  const name = str(e.event)
  const data = (e.data ?? null) as Record<string, unknown> | null
  if (!name || !data || !name.startsWith("charge.dispute.")) return null
  const tx = (data.transaction ?? {}) as Record<string, unknown>
  const meta = (tx.metadata ?? {}) as Record<string, unknown>
  const resolution = str(data.resolution)
  const status = paystackStatus(str(data.status), resolution)
  const id = str(data.id)
  if (!id) return null
  return {
    provider: "paystack",
    providerEventId: str(e.id) ?? `${name}:${id}:${str(data.updatedAt) ?? str(data.updated_at) ?? ""}`,
    type: name.endsWith(".resolve") ? "resolved" : name.endsWith(".create") ? "opened" : "updated",
    providerDisputeId: id,
    transactionRef: str(tx.reference) ?? str(tx.id),
    paymentId: str(meta.paymentId),
    checkoutId: str(meta.checkoutId) ?? str(meta.checkout_id),
    status,
    resolution: status === "lost" ? "lost" : status === "won" ? "won" : null,
    // Paystack amounts are in the subunit (kobo, cents).
    refundMinor: num(data.refund_amount),
    amountMinor: num(tx.amount) ?? num(data.refund_amount),
    currency: str(data.currency) ?? str(tx.currency),
    category: str(data.category),
    evidenceDueAt: date(data.dueAt ?? data.due_at),
  }
}

/** The orders a dispute covers: by checkout, else by payment id / transaction reference. */
async function ordersFor(tx: Tx, e: DisputeEvent) {
  const conds = []
  if (e.checkoutId) conds.push(eq(orderStates.checkoutId, e.checkoutId))
  const refs = [e.paymentId, e.transactionRef].filter((x): x is string => !!x)
  if (refs.length) conds.push(inArray(orderStates.paymentId, refs))
  if (!conds.length) return []
  return tx
    .select({ orderRefId: orderStates.orderRefId, brandId: orderStates.brandId, checkoutId: orderStates.checkoutId, paymentId: orderStates.paymentId, totalMinor: orderStates.totalMinor, currency: orderStates.currency })
    .from(orderStates)
    .where(or(...conds))
}

/**
 * ORDERS export for CHECKOUT's webhook: records a dispute and keeps it current. While open, the
 * orders it covers can't complete (no payout of that money) and can't be cancelled or returned.
 * Lost: the provider has already taken the money back, so each order gets a succeeded refund
 * (kind 'dispute', posted to LEDGER), apportioned by order total and capped at what's left.
 * Won/closed: the orders go back to normal. Idempotent by state.
 */
export async function handleDisputeEvent(tx: Tx, evt: unknown): Promise<{ disputeId: string | null; matchedOrders: number }> {
  assertAmbientTx("handleDisputeEvent")
  const e = normalizeDisputeEvent(evt)
  if (!e) {
    log.warn("[yard] orders: a dispute event couldn't be read; ignored")
    return { disputeId: null, matchedOrders: 0 }
  }
  const orders = await ordersFor(tx, e)
  const now = new Date()
  const status: DisputeState = e.status ?? (e.type === "resolved" ? (e.resolution === "lost" ? "lost" : e.resolution === "won" ? "won" : "closed") : "open")
  const currency = e.currency ?? orders[0]?.currency ?? "NGN"
  const amountMinor = e.amountMinor ?? orders.reduce((s, o) => s + o.totalMinor, 0)

  const [prev] = await tx
    .select()
    .from(orderDisputes)
    .where(and(eq(orderDisputes.provider, e.provider), eq(orderDisputes.providerDisputeId, e.providerDisputeId)))
    .for("update")
    .limit(1)
  const terminal = (s: string) => s === "won" || s === "lost" || s === "closed"
  let row: DisputeRow
  if (!prev) {
    ;[row] = await tx
      .insert(orderDisputes)
      .values({
        id: newId("dp"),
        provider: e.provider,
        providerDisputeId: e.providerDisputeId,
        checkoutId: e.checkoutId ?? orders[0]?.checkoutId ?? null,
        paymentId: e.paymentId ?? orders[0]?.paymentId ?? null,
        orderRefIds: orders.map((o) => o.orderRefId),
        brandIds: [...new Set(orders.map((o) => o.brandId))],
        status,
        category: e.category ?? null,
        amountMinor,
        currency,
        evidenceDueAt: e.evidenceDueAt ?? null,
        lastProviderEventId: e.providerEventId ?? null,
        openedAt: now,
        resolvedAt: terminal(status) ? now : null,
      })
      .returning()
  } else {
    // A late "remind" never reopens a resolved dispute.
    const next = terminal(prev.status) && !terminal(status) ? prev.status : status
    const brandIds = orders.length ? [...new Set(orders.map((o) => o.brandId))] : prev.brandIds
    // The brands covered can change as orders are matched: keep each brand's evidence its own.
    const brandEvidence = brandIds.join() === prev.brandIds.join() ? prev.brandEvidence : encodeEvidence(brandIds, evidenceByBrand(prev).byBrand)
    ;[row] = await tx
      .update(orderDisputes)
      .set({
        status: next,
        evidenceDueAt: e.evidenceDueAt ?? prev.evidenceDueAt,
        category: e.category ?? prev.category,
        orderRefIds: orders.length ? orders.map((o) => o.orderRefId) : prev.orderRefIds,
        brandIds,
        brandEvidence,
        lastProviderEventId: e.providerEventId ?? prev.lastProviderEventId,
        resolvedAt: terminal(next) ? (prev.resolvedAt ?? now) : null,
        updatedAt: now,
      })
      .where(eq(orderDisputes.id, prev.id))
      .returning()
  }

  const flag = row.status === "won" ? "won" : row.status === "lost" ? "lost" : row.status === "closed" ? "none" : "open"
  for (const o of orders) {
    const locked = await lockOrder(tx, o.orderRefId)
    if (!locked) continue
    if (locked.state.disputeStatus !== flag) {
      await updateState(tx, o.orderRefId, { disputeStatus: flag })
      await addEvent(tx, o.orderRefId, `dispute.${row.status}`, { kind: "provider", id: null }, { disputeId: row.id })
      await announce(locked.order, "dispute")
    }
  }

  if (row.status === "lost" && orders.length) await recordDisputeLoss(tx, row, orders, e.refundMinor ?? row.amountMinor)

  if (!prev || prev.status !== row.status) {
    await writeAudit({ actor: { kind: "system", name: "Payment provider" }, action: `order.dispute_${row.status}`, target: `Dispute ${row.providerDisputeId}`, subjectType: "order_dispute", subjectId: row.id, meta: { orders: row.orderRefIds, amountMinor: row.amountMinor, currency: row.currency, provider: row.provider } })
    // Admin queues refetch; brands see it on their order pages.
    await publish(channels.admin, "orders.dispute", { disputeId: row.id, status: row.status })
    for (const b of row.brandIds) await publish(channels.brand(b), "orders.dispute", { disputeId: row.id, status: row.status })
  }
  if (!orders.length) log.warn(`[yard] orders: dispute ${e.providerDisputeId} matched no order (checkout ${e.checkoutId ?? "-"}, ref ${e.transactionRef ?? "-"})`)
  return { disputeId: row.id, matchedOrders: orders.length }
}

/** Splits what the provider took across the disputed orders (largest remainder last), each capped. */
async function recordDisputeLoss(tx: Tx, row: DisputeRow, orders: { orderRefId: string; totalMinor: number }[], takenMinor: number) {
  const gross = orders.reduce((s, o) => s + o.totalMinor, 0)
  if (gross <= 0 || takenMinor <= 0) return
  let left = Math.min(takenMinor, gross)
  for (const [i, o] of orders.entries()) {
    const share = i === orders.length - 1 ? left : Math.floor((takenMinor * o.totalMinor) / gross)
    left -= share
    const cap = o.totalMinor - (await committedRefunds(tx, o.orderRefId))
    const amount = Math.min(share, cap)
    if (amount <= 0) continue
    try {
      await issueRefund(tx, { orderRefId: o.orderRefId, amountMinor: amount, reason: "Payment dispute lost", kind: "dispute", disputeId: row.id, idempotencyKey: `dispute:${row.id}`, actor: { kind: "provider", id: null }, providerTaken: true })
    } catch (err) {
      log.error(`[yard] orders: couldn't record dispute loss ${row.id} on ${o.orderRefId}`, err)
    }
  }
}

/* ---------- Per-brand evidence ---------- */

/**
 * One provider dispute can cover orders from several brands (one Paystack transaction paid for
 * them all), but each brand's evidence is its own: brands never read or replace each other's.
 * Storage, in the single `brand_evidence` column (no migration needed):
 *  - a dispute covering one brand: the plain text, as before;
 *  - a dispute covering several brands: MULTI_PREFIX + JSON `{ [brandId]: { text, at } }`.
 * Plain text on a multi-brand dispute (written before per-brand storage) has no known author, so
 * no brand is shown it; Yard's admins still see it.
 */
const MULTI_PREFIX = "yard:evidence-by-brand:v1:"
/** The column's check constraint (order_disputes_evidence_len_ck). */
const EVIDENCE_COLUMN_MAX = 4000
export type BrandEvidence = { text: string; at: string }

export function evidenceByBrand(d: Pick<DisputeRow, "brandEvidence" | "brandEvidenceAt" | "brandIds">): { byBrand: Record<string, BrandEvidence>; unattributed: string | null } {
  const raw = d.brandEvidence
  if (!raw) return { byBrand: {}, unattributed: null }
  if (raw.startsWith(MULTI_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(MULTI_PREFIX.length)) as Record<string, BrandEvidence>
      const byBrand: Record<string, BrandEvidence> = {}
      for (const [b, v] of Object.entries(parsed ?? {})) if (v && typeof v.text === "string" && typeof v.at === "string") byBrand[b] = { text: v.text, at: v.at }
      return { byBrand, unattributed: null }
    } catch {
      return { byBrand: {}, unattributed: null }
    }
  }
  if (d.brandIds.length === 1) return { byBrand: { [d.brandIds[0]]: { text: raw, at: (d.brandEvidenceAt ?? new Date(0)).toISOString() } }, unattributed: null }
  return { byBrand: {}, unattributed: raw }
}

/** The column value for these brands' evidence (plain text when the dispute covers one brand). */
function encodeEvidence(brandIds: string[], byBrand: Record<string, BrandEvidence>): string | null {
  const entries = Object.entries(byBrand).filter(([b]) => brandIds.includes(b))
  if (!entries.length) return null
  if (brandIds.length === 1) return entries[0][1].text
  return MULTI_PREFIX + JSON.stringify(Object.fromEntries(entries))
}

/* ---------- Brand and admin access ---------- */

export async function disputesForOrder(tx: Executor, orderRefId: string) {
  return tx
    .select()
    .from(orderDisputes)
    .where(sql`${orderRefId} = any(${orderDisputes.orderRefIds})`)
    .orderBy(desc(orderDisputes.openedAt))
}

/** The brand's account of the order, for Yard to submit as evidence. */
export async function submitBrandEvidence(tx: Tx, input: { orderRefId: string; disputeId: string; brandId: string; actor: OrderActor; evidence: string; ipHash?: string | null }) {
  const [order] = await tx.select().from(orderRefs).where(and(eq(orderRefs.id, input.orderRefId), eq(orderRefs.brandId, input.brandId))).limit(1)
  if (!order) throw notFound()
  const [d] = await tx.select().from(orderDisputes).where(eq(orderDisputes.id, input.disputeId)).for("update").limit(1)
  if (!d || !d.orderRefIds.includes(order.id)) throw notFound()
  if (d.status === "won" || d.status === "lost" || d.status === "closed") throw conflict("This dispute has been resolved.")
  if (!d.brandIds.includes(order.brandId)) throw notFound()
  const now = new Date()
  // Only this brand's entry changes; other brands' evidence on a shared dispute is kept as is.
  const { byBrand } = evidenceByBrand(d)
  byBrand[order.brandId] = { text: input.evidence.trim(), at: now.toISOString() }
  const encoded = encodeEvidence(d.brandIds, byBrand)
  if (encoded && encoded.length > EVIDENCE_COLUMN_MAX) {
    throw rule("This payment covers orders from several brands, so the evidence they share has to be shorter. Keep yours to the key facts (tracking, delivery proof).")
  }
  const [row] = await tx.update(orderDisputes).set({ brandEvidence: encoded, brandEvidenceAt: now, updatedAt: now }).where(eq(orderDisputes.id, d.id)).returning()
  await addEvent(tx, order.id, "dispute.evidence_added", input.actor, { disputeId: d.id })
  await writeAudit({ actor: { kind: "brand", id: input.actor.id, name: input.actor.name, role: input.actor.role }, action: "order.dispute_evidence", target: `Order ${order.reference}`, subjectType: "order_dispute", subjectId: d.id, brandId: order.brandId, ipHash: input.ipHash ?? null, meta: { orderId: order.id } })
  await publish(channels.admin, "orders.dispute", { disputeId: d.id, status: d.status })
  return { row, orderTotalMinor: order.totalMinor }
}

export async function listDisputes(tx: Executor, q: { status?: DisputeState; limit: number }) {
  return tx
    .select()
    .from(orderDisputes)
    .where(q.status ? eq(orderDisputes.status, q.status) : undefined)
    .orderBy(desc(orderDisputes.openedAt))
    .limit(q.limit)
}

export async function adminUpdateDispute(tx: Tx, input: { disputeId: string; actor: OrderActor; adminNote?: string; responseSubmitted?: boolean; status?: "under_review" | "closed"; ipHash?: string | null }) {
  const [d] = await tx.select().from(orderDisputes).where(eq(orderDisputes.id, input.disputeId)).for("update").limit(1)
  if (!d) throw notFound()
  const now = new Date()
  const patch: Partial<typeof orderDisputes.$inferInsert> = { updatedAt: now }
  if (input.adminNote !== undefined) patch.adminNote = input.adminNote.trim() || null
  if (input.responseSubmitted) patch.responseSubmittedAt = d.responseSubmittedAt ?? now
  if (input.status) {
    if (d.status === "won" || d.status === "lost") throw conflict("The provider has already resolved this dispute.")
    patch.status = input.status
    if (input.status === "closed") patch.resolvedAt = now
  }
  const [row] = await tx.update(orderDisputes).set(patch).where(eq(orderDisputes.id, d.id)).returning()
  if (input.status === "closed") {
    for (const id of d.orderRefIds) {
      const locked = await lockOrder(tx, id)
      if (locked && locked.state.disputeStatus === "open") await updateState(tx, id, { disputeStatus: "none" })
    }
  }
  await writeAudit({ actor: { kind: "admin", id: input.actor.id, name: input.actor.name, role: input.actor.role }, action: "order.dispute_updated", target: `Dispute ${d.providerDisputeId}`, subjectType: "order_dispute", subjectId: d.id, ipHash: input.ipHash ?? null, meta: { status: row.status, responseSubmitted: !!row.responseSubmittedAt, noteChanged: input.adminNote !== undefined } })
  await publish(channels.admin, "orders.dispute", { disputeId: d.id, status: row.status })
  return row
}
