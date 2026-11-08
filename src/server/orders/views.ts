import "server-only"
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm"
import type { z } from "zod"
import { db, type Executor } from "../db"
import { brands, orderGroups, orderRefs } from "../db/schema"
import type { OrderRefItem } from "../db/schema/orders"
import { orderEvents, orderLines, orderRefunds, orderReturnLines, orderReturns, orderStates } from "../db/schema/orders-v3"
import { notFound } from "../http/errors"
import { deliveryFor } from "../shipping/orders"
import type { brandOrdersQuery, DisputeDto, OrderDetailDto, OrderLineDto, OrdersPageDto, OrderStatesDto, OrderSummaryDto, RefundDto, ReturnDto } from "./contracts"
import { returnReasonLabels } from "./contracts"
import { committedRefunds, deriveFulfilment, isOrderRefId, shipmentEventsFor, type OrderRefRow, type OrderStateRow } from "./core"
import { disputesForOrder, type DisputeRow } from "./disputes"

type Viewer = "shopper" | "brand" | "admin"
const CAPTURED = new Set(["paid", "partially_refunded"])
const CANCELLABLE_MERCHANT = new Set(["pending_payment", "paid", "processing"])

type Row = { order: OrderRefRow; state: OrderStateRow | null; brand: { id: string; name: string; handle: string } | null; groupReference: string | null }

/** Payment state for an order with or without a v3 state row. */
const paymentOf = (o: OrderRefRow, s: OrderStateRow | null) => s?.paymentStatus ?? (o.status === "refunded" ? "refunded" : o.paid ? "paid" : "pending")

function statesOf(r: Row, events: { status: string; occurredAt: Date }[]): OrderStatesDto & { deliveredAt: Date | null; returnWindowEndsAt: Date | null; shipped: boolean } {
  const s = r.state
  const f = deriveFulfilment({ fulfilmentStatus: s?.fulfilmentStatus ?? (r.order.status === "cancelled" ? "cancelled" : "unfulfilled"), deliveredAt: s?.deliveredAt ?? null, cancelledAt: s?.cancelledAt ?? (r.order.status === "cancelled" ? r.order.createdAt : null) }, r.order, events)
  return {
    merchant: r.order.status,
    payment: paymentOf(r.order, s),
    fulfilment: f.fulfilment,
    return: s?.returnStatus ?? (r.order.status === "refund_requested" ? "requested" : "none"),
    dispute: s?.disputeStatus ?? "none",
    deliveredAt: f.deliveredAt ?? s?.deliveredAt ?? null,
    returnWindowEndsAt: f.returnWindowEndsAt ?? s?.returnWindowEndsAt ?? null,
    shipped: f.shipped,
  }
}

function summaryOf(r: Row, states: OrderStatesDto): OrderSummaryDto {
  const items = (r.order.items ?? []) as OrderRefItem[]
  return {
    id: r.order.id,
    reference: r.order.reference,
    groupReference: r.groupReference ?? r.order.reference.replace(/-\d+$/, ""),
    checkoutId: r.state?.checkoutId ?? null,
    brand: r.brand ?? { id: r.order.brandId, name: "The brand", handle: "" },
    placedAt: r.order.placedAt.toISOString(),
    currency: r.order.currency,
    subtotalMinor: r.order.subtotalMinor,
    shippingMinor: r.order.shippingMinor,
    totalMinor: r.order.totalMinor,
    refundedMinor: r.state?.refundedMinor ?? 0,
    itemCount: items.reduce((s, i) => s + (i.qty || 0), 0),
    states: { merchant: states.merchant, payment: states.payment, fulfilment: states.fulfilment, return: states.return, dispute: states.dispute },
    service: r.order.service,
  }
}

async function selectRows(tx: Executor, where: SQL | undefined, limit: number) {
  const rows = await tx
    .select({ order: orderRefs, state: orderStates, brand: { id: brands.id, name: brands.name, handle: brands.handle }, groupReference: orderGroups.reference })
    .from(orderRefs)
    .leftJoin(orderStates, eq(orderStates.orderRefId, orderRefs.id))
    .leftJoin(brands, eq(brands.id, orderRefs.brandId))
    .leftJoin(orderGroups, eq(orderGroups.id, orderRefs.groupId))
    .where(where)
    .orderBy(desc(orderRefs.placedAt), desc(orderRefs.id))
    .limit(limit)
  return rows as Row[]
}

async function page(tx: Executor, where: SQL | undefined, limit: number): Promise<OrdersPageDto<OrderSummaryDto>> {
  const rows = await selectRows(tx, where, limit + 1)
  const more = rows.length > limit
  const slice = rows.slice(0, limit)
  const events = await shipmentEventsFor(tx, slice.map((r) => r.order.id))
  const items = slice.map((r) => summaryOf(r, statesOf(r, events.get(r.order.id) ?? [])))
  return { items, nextCursor: more ? slice[slice.length - 1].order.placedAt.toISOString() : null }
}

/** The shopper's own orders, newest first, from any device (server-side, by account). */
export async function shopperOrders(customerId: string, q: { before?: string; limit: number }) {
  const d = await db()
  const conds = [eq(orderRefs.customerId, customerId)]
  if (q.before) conds.push(lt(orderRefs.placedAt, new Date(q.before)))
  return page(d, and(...conds), q.limit)
}

/** SQL view of fulfilment for filters (stored state lags shipping's events until the next write or job). */
const fulfilmentSql = sql<string>`case
  when ${orderStates.fulfilmentStatus} = 'cancelled' or ${orderRefs.status} = 'cancelled' then 'cancelled'
  when ${orderStates.fulfilmentStatus} = 'returned_to_sender' then 'returned_to_sender'
  when ${orderRefs.status} = 'delivered' or ${orderStates.deliveredAt} is not null then 'delivered'
  when ${orderRefs.status} = 'shipped' then 'shipped'
  when ${orderRefs.status} = 'processing' then 'processing'
  else coalesce(${orderStates.fulfilmentStatus}, 'unfulfilled') end`
const paymentSql = sql<string>`coalesce(${orderStates.paymentStatus}, case when ${orderRefs.status} = 'refunded' then 'refunded' when ${orderRefs.paid} then 'paid' else 'pending' end)`

export async function brandOrders(brandId: string, q: z.output<typeof brandOrdersQuery>) {
  const d = await db()
  const conds: SQL[] = [eq(orderRefs.brandId, brandId)]
  if (q.before) conds.push(lt(orderRefs.placedAt, new Date(q.before)))
  if (q.payment) conds.push(sql`${paymentSql} = ${q.payment}`)
  if (q.fulfilment) conds.push(sql`${fulfilmentSql} = ${q.fulfilment}`)
  if (q.returns === "open") conds.push(or(inArray(orderStates.returnStatus, ["requested", "approved"]), eq(orderRefs.status, "refund_requested"))!)
  else if (q.returns === "any") conds.push(sql`${orderStates.returnStatus} is not null and ${orderStates.returnStatus} <> 'none'`)
  if (q.q) conds.push(ilike(orderRefs.reference, `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`))
  return page(d, and(...conds), q.limit)
}

/* ---------- Detail ---------- */

function toReturnDto(r: typeof orderReturns.$inferSelect, lines: { orderLineId: string; variantId: string; title: string; qty: number }[]): ReturnDto {
  return {
    id: r.id,
    status: r.status,
    reason: r.reason,
    reasonLabel: returnReasonLabels[r.reason as keyof typeof returnReasonLabels] ?? r.reason,
    note: r.note,
    lines,
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decidedBy: (r.decidedByKind as "brand" | "platform" | null) ?? null,
    decisionReason: r.decisionReason,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    refundId: r.refundId,
  }
}

const toRefundDto = (r: typeof orderRefunds.$inferSelect): RefundDto => ({ id: r.id, kind: r.kind, status: r.status, amountMinor: r.amountMinor, currency: r.currency, reason: r.reason, createdAt: r.createdAt.toISOString(), settledAt: r.settledAt?.toISOString() ?? null, returnId: r.returnId })

export const toDisputeDto = (d: DisputeRow, viewer: Viewer): DisputeDto & { adminNote?: string | null; provider?: string; providerDisputeId?: string; orderRefIds?: string[] } => ({
  id: d.id,
  status: d.status,
  category: d.category,
  amountMinor: d.amountMinor,
  currency: d.currency,
  evidenceDueAt: d.evidenceDueAt?.toISOString() ?? null,
  brandEvidence: d.brandEvidence,
  brandEvidenceAt: d.brandEvidenceAt?.toISOString() ?? null,
  responseSubmittedAt: d.responseSubmittedAt?.toISOString() ?? null,
  openedAt: d.openedAt.toISOString(),
  resolvedAt: d.resolvedAt?.toISOString() ?? null,
  ...(viewer === "admin" ? { adminNote: d.adminNote, provider: d.provider, providerDisputeId: d.providerDisputeId, orderRefIds: d.orderRefIds } : {}),
})

/**
 * One order as its shopper, its brand, or Yard sees it. Scoping is in the query (another
 * shopper's or brand's order is 404). Reads never write: a legacy order without a state row is
 * shown from its order_ref.
 */
export async function orderDetail(viewer: Viewer, orderRefId: string, scope: { customerId?: string; brandId?: string }): Promise<OrderDetailDto> {
  if (!isOrderRefId(orderRefId)) throw notFound()
  const d = await db()
  const conds = [eq(orderRefs.id, orderRefId)]
  if (scope.customerId) conds.push(eq(orderRefs.customerId, scope.customerId))
  if (scope.brandId) conds.push(eq(orderRefs.brandId, scope.brandId))
  const [r] = await selectRows(d, and(...conds), 1)
  if (!r) throw notFound()
  const events = (await shipmentEventsFor(d, [r.order.id])).get(r.order.id) ?? []
  const st = statesOf(r, events)

  const lineRows = await d.select().from(orderLines).where(eq(orderLines.orderRefId, r.order.id)).orderBy(asc(orderLines.position))
  const lines: OrderLineDto[] = lineRows.length
    ? lineRows.map((l) => ({ id: l.id, variantId: l.variantId, productId: l.productId, title: l.title, qty: l.qty, unitMinor: l.unitMinor, returnedQty: l.returnedQty, restockedQty: l.restockedQty }))
    : ((r.order.items ?? []) as OrderRefItem[]).map((i, n) => ({ id: `item-${n}`, variantId: i.variantId, productId: i.productId, title: i.name, qty: i.qty, unitMinor: i.unitMinor, returnedQty: 0, restockedQty: 0 }))

  const returnRows = await d.select().from(orderReturns).where(eq(orderReturns.orderRefId, r.order.id)).orderBy(desc(orderReturns.requestedAt))
  const rLines = returnRows.length
    ? await d
        .select({ returnId: orderReturnLines.returnId, orderLineId: orderReturnLines.orderLineId, qty: orderReturnLines.qty, variantId: orderLines.variantId, title: orderLines.title })
        .from(orderReturnLines)
        .innerJoin(orderLines, eq(orderLines.id, orderReturnLines.orderLineId))
        .where(inArray(orderReturnLines.returnId, returnRows.map((x) => x.id)))
    : []
  const refundRows = await d.select().from(orderRefunds).where(eq(orderRefunds.orderRefId, r.order.id)).orderBy(desc(orderRefunds.createdAt))
  const disputeRows = viewer === "shopper" ? [] : await disputesForOrder(d, r.order.id)
  const timeline = await d.select().from(orderEvents).where(eq(orderEvents.orderRefId, r.order.id)).orderBy(asc(orderEvents.at))
  const committed = r.state ? await committedRefunds(d, r.order.id) : 0
  const total = r.state?.totalMinor ?? r.order.totalMinor
  const refundable = CAPTURED.has(st.payment) && r.state?.paymentId ? Math.max(0, total - committed) : 0

  const openReturn = returnRows.some((x) => x.status === "requested" || x.status === "approved")
  const unitsLeft = lines.some((l) => l.qty - l.returnedQty > 0)
  const now = Date.now()
  const actions = {
    canCancel: st.fulfilment !== "cancelled" && !st.shipped && CANCELLABLE_MERCHANT.has(r.order.status) && !openReturn && st.dispute !== "open",
    canRequestReturn: viewer === "shopper" && CAPTURED.has(st.payment) && st.fulfilment === "delivered" && !!st.returnWindowEndsAt && st.returnWindowEndsAt.getTime() >= now && !openReturn && st.dispute !== "open" && unitsLeft,
    returnWindowEndsAt: st.returnWindowEndsAt?.toISOString() ?? null,
  }

  const delivery = await deliveryFor(r.order, viewer === "shopper" ? "shopper" : "brand").catch(() => null)
  return {
    ...summaryOf(r, st),
    lines,
    shipTo: (r.state?.shipTo as Record<string, unknown> | null) ?? { country: r.order.shipToCountry, city: r.order.shipToCity },
    paidAt: r.state?.paidAt?.toISOString() ?? null,
    cancelledAt: r.state?.cancelledAt?.toISOString() ?? null,
    cancelReason: r.state?.cancelReason ?? null,
    deliveredAt: st.deliveredAt?.toISOString() ?? null,
    completedAt: r.state?.completedAt?.toISOString() ?? null,
    refundableMinor: refundable,
    returns: returnRows.map((x) => toReturnDto(x, rLines.filter((l) => l.returnId === x.id).map((l) => ({ orderLineId: l.orderLineId, variantId: l.variantId, title: l.title, qty: l.qty })))),
    refunds: refundRows.map(toRefundDto),
    disputes: disputeRows.map((x) => toDisputeDto(x, viewer)),
    timeline: timeline.map((e) => ({ id: e.id, kind: e.kind, actorKind: e.actorKind, at: e.at.toISOString(), data: e.data })),
    actions,
    delivery,
  }
}

/** The shopper's orders from one checkout (the receipt page after payment). */
export async function checkoutOrders(customerId: string, checkoutId: string) {
  const d = await db()
  const states = await d.select({ id: orderStates.orderRefId }).from(orderStates).where(and(eq(orderStates.checkoutId, checkoutId), eq(orderStates.customerId, customerId)))
  if (!states.length) throw notFound()
  return page(d, inArray(orderRefs.id, states.map((s) => s.id)), 50)
}
