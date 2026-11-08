import "server-only"
import { and, eq, inArray, lt, sql } from "drizzle-orm"
import type { z } from "zod"
import { writeAudit } from "../audit"
import { withTx, type Tx } from "../db"
import { orderLines, orderReturnLines, orderReturns, type RETURN_REASONS } from "../db/schema/orders-v3"
import { conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { restockLines } from "./cancel"
import type { returnReceiveBody } from "./contracts"
import { addEvent, announce, committedRefunds, emailCustomer, linesOf, orderUrl, lockOrder, setMerchantStatus, syncFulfilment, SYSTEM, updateState, type OrderActor } from "./core"
import { issueRefund, money } from "./refunds"

export type ReturnRow = typeof orderReturns.$inferSelect

const CAPTURED = new Set(["paid", "partially_refunded"])
/** An approved return the shopper never sent back closes after this many days. */
export const RETURN_SHIP_BACK_DAYS = 30

async function returnOf(tx: Tx, orderRefId: string, returnId: string) {
  const [r] = await tx
    .select()
    .from(orderReturns)
    .where(and(eq(orderReturns.id, returnId), eq(orderReturns.orderRefId, orderRefId)))
    .limit(1)
  return r ?? null
}

async function returnLinesOf(tx: Tx, returnId: string) {
  return tx.select().from(orderReturnLines).where(eq(orderReturnLines.returnId, returnId))
}

/** Back to what fulfilment says once no return or refund is pending. */
async function restoreMerchantStatus(tx: Tx, orderRefId: string, fulfilment: string) {
  await setMerchantStatus(tx, orderRefId, fulfilment === "delivered" ? "delivered" : fulfilment === "shipped" ? "shipped" : "paid")
}

/**
 * The shopper asks to return some or all of a delivered order, within the return window
 * (RETURN_WINDOW_DAYS after delivery). One open return per order; idempotent per key.
 */
export async function requestReturn(
  tx: Tx,
  input: { orderRefId: string; customerId: string; actor: OrderActor; lines?: { variantId: string; qty: number }[]; reason: (typeof RETURN_REASONS)[number]; note: string; idempotencyKey: string },
) {
  const [dup] = await tx
    .select()
    .from(orderReturns)
    .where(and(eq(orderReturns.customerId, input.customerId), eq(orderReturns.idempotencyKey, input.idempotencyKey)))
    .limit(1)
  if (dup) {
    if (dup.orderRefId !== input.orderRefId) throw conflict("That request key was already used for another order. Reload and try again.")
    return { returnId: dup.id, duplicate: true }
  }
  const locked = await lockOrder(tx, input.orderRefId)
  if (!locked || locked.order.customerId !== input.customerId) throw notFound()
  const { order } = locked
  const { state } = await syncFulfilment(tx, order, locked.state)

  if (!CAPTURED.has(state.paymentStatus)) throw rule(state.paymentStatus === "refunded" ? "This order has already been refunded in full." : "Only paid orders can be returned.")
  if (state.fulfilmentStatus !== "delivered") throw rule("You can request a return once your order has been delivered.")
  if (!state.returnWindowEndsAt || state.returnWindowEndsAt.getTime() < Date.now()) throw rule("The return window for this order has closed.")
  if (state.disputeStatus === "open") throw conflict("This order's payment is disputed with your bank, so Yard's team is handling it.")
  const [open] = await tx
    .select({ id: orderReturns.id })
    .from(orderReturns)
    .where(and(eq(orderReturns.orderRefId, order.id), inArray(orderReturns.status, ["requested", "approved"])))
    .limit(1)
  if (open) throw conflict("There's already a return in progress on this order.")

  const lines = await linesOf(tx, order.id)
  const byVariant = new Map(lines.map((l) => [l.variantId, l]))
  const picked: { lineId: string; qty: number }[] = []
  if (input.lines?.length) {
    const seen = new Set<string>()
    for (const [i, want] of input.lines.entries()) {
      const l = byVariant.get(want.variantId)
      if (!l) throw rule(`Item ${i + 1} isn't on this order.`)
      if (seen.has(l.id)) throw rule(`Item ${i + 1} is listed twice.`)
      seen.add(l.id)
      const available = l.qty - l.returnedQty
      if (want.qty > available) throw rule(available ? `You can return at most ${available} of ${l.title}.` : `${l.title} has already been returned.`)
      picked.push({ lineId: l.id, qty: want.qty })
    }
  } else {
    for (const l of lines) if (l.qty - l.returnedQty > 0) picked.push({ lineId: l.id, qty: l.qty - l.returnedQty })
  }
  if (!picked.length) throw rule("Everything on this order has already been returned.")

  const id = newId("rt")
  try {
    await tx.insert(orderReturns).values({ id, orderRefId: order.id, brandId: order.brandId, customerId: order.customerId, status: "requested", reason: input.reason, note: input.note.trim(), idempotencyKey: input.idempotencyKey })
  } catch (e) {
    if (e instanceof Error && /duplicate key|unique/i.test(e.message)) throw conflict("There's already a return in progress on this order.")
    throw e
  }
  await tx.insert(orderReturnLines).values(picked.map((p) => ({ id: newId("rl"), returnId: id, orderLineId: p.lineId, qty: p.qty })))
  await updateState(tx, order.id, { returnStatus: "requested" })
  await setMerchantStatus(tx, order.id, "refund_requested")
  await addEvent(tx, order.id, "return.requested", input.actor, { returnId: id, reason: input.reason, units: picked.reduce((s, p) => s + p.qty, 0) })
  await announce(order, "return")
  return { returnId: id, duplicate: false }
}

/** The shopper withdraws a return the brand hasn't decided yet. */
export async function cancelReturn(tx: Tx, input: { orderRefId: string; returnId: string; customerId: string; actor: OrderActor }) {
  const locked = await lockOrder(tx, input.orderRefId)
  if (!locked || locked.order.customerId !== input.customerId) throw notFound()
  const r = await returnOf(tx, input.orderRefId, input.returnId)
  if (!r) throw notFound()
  if (r.status === "cancelled") return { returnId: r.id, status: r.status }
  if (r.status !== "requested") throw conflict(r.status === "approved" ? "The brand has already approved this return. Message them if you've changed your mind." : "This return has already been decided.")
  await tx.update(orderReturns).set({ status: "cancelled", updatedAt: new Date() }).where(eq(orderReturns.id, r.id))
  await updateState(tx, input.orderRefId, { returnStatus: "cancelled" })
  await restoreMerchantStatus(tx, input.orderRefId, locked.state.fulfilmentStatus)
  await addEvent(tx, input.orderRefId, "return.cancelled", input.actor, { returnId: r.id })
  await announce(locked.order, "return")
  return { returnId: r.id, status: "cancelled" }
}

/** The brand (or Yard, as a platform decision) approves or declines a requested return. */
export async function decideReturn(tx: Tx, input: { orderRefId: string; returnId: string; actor: OrderActor; decision: "approve" | "reject"; reason?: string; brandId?: string; ipHash?: string | null }) {
  const locked = await lockOrder(tx, input.orderRefId)
  if (!locked || (input.brandId && locked.order.brandId !== input.brandId)) throw notFound()
  const { order, state } = locked
  const r = await returnOf(tx, order.id, input.returnId)
  if (!r) throw notFound()
  const target = input.decision === "approve" ? "approved" : "rejected"
  if (r.status === target) return { returnId: r.id, status: r.status }
  // Yard can overturn a brand's decline (platform decision); a brand decides only requested returns.
  const platformOverride = input.actor.kind === "admin" && r.status === "rejected" && target === "approved"
  if (r.status !== "requested" && !platformOverride) throw conflict("This return has already been decided.")
  const now = new Date()
  const decidedByKind = input.actor.kind === "admin" ? "platform" : "brand"
  await tx
    .update(orderReturns)
    .set({ status: target, decidedAt: now, decidedByKind, decidedBy: input.actor.id, decisionReason: input.reason?.trim() || null, updatedAt: now })
    .where(eq(orderReturns.id, r.id))
  await updateState(tx, order.id, { returnStatus: target })
  if (target === "rejected") await restoreMerchantStatus(tx, order.id, state.fulfilmentStatus)
  else await setMerchantStatus(tx, order.id, "refund_requested")
  await addEvent(tx, order.id, `return.${target}`, input.actor, { returnId: r.id, by: decidedByKind })
  await emailCustomer(tx, order.customerId, "return_update", { reference: order.reference, status: target === "approved" ? "approved: send the items back to the brand" : `declined${input.reason?.trim() ? ` (${input.reason.trim().slice(0, 200)})` : ""}`, url: orderUrl(order.id) }, `return-${target}:${r.id}`)
  await writeAudit({
    actor: { kind: input.actor.kind === "admin" ? "admin" : "brand", id: input.actor.id, name: input.actor.name, role: input.actor.role },
    action: `order.return_${target}`,
    target: `Order ${order.reference}`,
    subjectType: "order_return",
    subjectId: r.id,
    brandId: order.brandId,
    reason: input.reason?.trim() || null,
    ipHash: input.ipHash ?? null,
    meta: { orderId: order.id, previous: r.status, platform: decidedByKind === "platform" },
  })
  await announce(order, "return")
  return { returnId: r.id, status: target }
}

/**
 * The returned parcel arrived: lines are marked returned, optionally restocked (CATALOG), and by
 * default refunded (PAYMENTS → LEDGER). Everything back and nothing refunded yet → the full total,
 * shipping included; otherwise the returned items. A lower amount may be given, never more.
 */
export async function receiveReturn(tx: Tx, input: { orderRefId: string; returnId: string; actor: OrderActor; brandId?: string; ipHash?: string | null } & z.output<typeof returnReceiveBody>) {
  const locked = await lockOrder(tx, input.orderRefId)
  if (!locked || (input.brandId && locked.order.brandId !== input.brandId)) throw notFound()
  const { order, state } = locked
  const r = await returnOf(tx, order.id, input.returnId)
  if (!r) throw notFound()
  if (r.status === "received") return { returnId: r.id, status: r.status, refundId: r.refundId }
  if (r.status !== "approved" && r.status !== "requested") throw conflict(r.status === "rejected" ? "This return was declined." : "This return is closed.")

  const rLines = await returnLinesOf(tx, r.id)
  const lines = await linesOf(tx, order.id)
  const byId = new Map(lines.map((l) => [l.id, l]))
  const qtyByLine = new Map<string, number>()
  let itemsMinor = 0
  for (const rl of rLines) {
    const l = byId.get(rl.orderLineId)
    if (!l) continue
    const qty = Math.min(rl.qty, l.qty - l.returnedQty)
    if (qty <= 0) continue
    qtyByLine.set(l.id, qty)
    itemsMinor += qty * l.unitMinor
    await tx
      .update(orderLines)
      .set({ returnedQty: sql`${orderLines.returnedQty} + ${qty}` })
      .where(eq(orderLines.id, l.id))
  }
  const now = new Date()
  let restocked = 0
  if (input.restock) restocked = await restockLines(tx, order, lines, qtyByLine, "Return received")

  const committed = await committedRefunds(tx, order.id)
  const after = lines.map((l) => ({ qty: l.qty, returned: l.returnedQty + (qtyByLine.get(l.id) ?? 0) }))
  const everything = after.every((l) => l.returned >= l.qty)
  const computed = Math.min(everything && committed === 0 ? state.totalMinor : itemsMinor, state.totalMinor - committed)
  if (input.amountMinor !== undefined && input.amountMinor > computed) throw rule(`The refund for this return can be at most ${money(computed, state.currency)}.`)
  const amount = input.amountMinor ?? computed

  let refundId: string | null = null
  if (input.refund && amount > 0 && CAPTURED.has(state.paymentStatus)) {
    const res = await issueRefund(tx, { orderRefId: order.id, amountMinor: amount, reason: "Return received", kind: "return", returnId: r.id, idempotencyKey: `return:${r.id}`, actor: input.actor })
    refundId = res.refund.id
  }
  await tx
    .update(orderReturns)
    .set({ status: "received", receivedAt: now, receivedBy: input.actor.id, restocked, refundId, updatedAt: now, ...(r.status === "requested" ? { decidedAt: now, decidedByKind: input.actor.kind === "admin" ? "platform" : "brand", decidedBy: input.actor.id } : {}) })
    .where(eq(orderReturns.id, r.id))
  await updateState(tx, order.id, { returnStatus: "received" })
  if (!refundId) await restoreMerchantStatus(tx, order.id, state.fulfilmentStatus)
  await emailCustomer(tx, order.customerId, "return_update", { reference: order.reference, status: refundId ? "received by the brand; your refund is being processed" : "received by the brand", url: orderUrl(order.id) }, `return-received:${r.id}`)
  await addEvent(tx, order.id, "return.received", input.actor, { returnId: r.id, restocked, refundId, amountMinor: refundId ? amount : 0 })
  await writeAudit({
    actor: { kind: input.actor.kind === "admin" ? "admin" : "brand", id: input.actor.id, name: input.actor.name, role: input.actor.role },
    action: "order.return_received",
    target: `Order ${order.reference}`,
    subjectType: "order_return",
    subjectId: r.id,
    brandId: order.brandId,
    ipHash: input.ipHash ?? null,
    meta: { orderId: order.id, restocked, refundId, amountMinor: refundId ? amount : 0, currency: state.currency },
  })
  await announce(order, "return")
  return { returnId: r.id, status: "received", refundId }
}

/** Job: approved returns never sent back within RETURN_SHIP_BACK_DAYS close as expired. */
export async function expireStaleReturns(now = Date.now()) {
  const cutoff = new Date(now - RETURN_SHIP_BACK_DAYS * 86_400_000)
  const stale = await withTx((tx) =>
    tx
      .select({ id: orderReturns.id, orderRefId: orderReturns.orderRefId })
      .from(orderReturns)
      .where(and(eq(orderReturns.status, "approved"), lt(orderReturns.decidedAt, cutoff)))
      .limit(200),
  )
  let expired = 0
  for (const s of stale) {
    await withTx(async (tx) => {
      const locked = await lockOrder(tx, s.orderRefId)
      if (!locked) return
      const [r] = await tx.update(orderReturns).set({ status: "expired", updatedAt: new Date() }).where(and(eq(orderReturns.id, s.id), eq(orderReturns.status, "approved"))).returning()
      if (!r) return
      await updateState(tx, s.orderRefId, { returnStatus: "expired" })
      await restoreMerchantStatus(tx, s.orderRefId, locked.state.fulfilmentStatus)
      await addEvent(tx, s.orderRefId, "return.expired", SYSTEM, { returnId: s.id })
      await announce(locked.order, "return")
      expired++
    })
  }
  return { checked: stale.length, expired }
}
