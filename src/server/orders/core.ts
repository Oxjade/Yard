import "server-only"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { PAYOUT_HOLD_DAYS } from "@/lib/payouts"
import type { Actor } from "../auth/dal"
import { inTransaction, type Executor, type Tx } from "../db"
import { enqueueEmail } from "../email"
import { getEnv } from "../env"
import { orderRefs, shipmentEvents } from "../db/schema"
import type { OrderRefItem } from "../db/schema/orders"
import { FULFILMENT_STATES, orderEvents, orderLines, orderRefunds, orderStates, type OrderShipTo } from "../db/schema/orders-v3"
import { newId } from "../ids"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"

/** Delivered orders can be returned for this many days; the order completes (LEDGER) after it. */
export const RETURN_WINDOW_DAYS = PAYOUT_HOLD_DAYS
const DAY = 86_400_000

export type OrderRefRow = typeof orderRefs.$inferSelect
export type OrderStateRow = typeof orderStates.$inferSelect
export type OrderLineRow = typeof orderLines.$inferSelect

export type OrderActor = { kind: "shopper" | "brand" | "admin" | "system" | "provider"; id: string | null; name?: string | null; role?: string | null }

export function orderActor(a: Actor): OrderActor {
  if (a.kind === "brand") return { kind: "brand", id: a.userId, name: a.name, role: a.role }
  if (a.kind === "admin") return { kind: "admin", id: a.userId, name: a.name, role: a.role }
  return { kind: "shopper", id: a.userId, name: a.name }
}

export const SYSTEM: OrderActor = { kind: "system", id: null, name: "Yard" }

/**
 * PGlite has one connection: a query on the root handle while a transaction is open wedges the
 * process (§1.3). The contract functions take `tx`, but the helpers they call (publish, audit,
 * notify, shipping's estimate engine) go through db(), which only joins an AMBIENT transaction,
 * so callers must pass a tx opened with withTx.
 */
export function assertAmbientTx(fn: string) {
  if (!inTransaction()) throw new Error(`orders.${fn} must run inside withTx (it was given a tx that withTx didn't open)`)
}

const SHIPPED = new Set(["shipped", "in_transit", "out_for_delivery", "delivered"])

export type ShipmentEventLite = { status: string; occurredAt: Date; /** When Yard recorded it (shipment_events.created_at). */ recordedAt?: Date }

/**
 * What shipping's events say about fulfilment (pure; reads never write).
 * The return window (and with it the payout hold) runs from when Yard RECORDED the delivery, not
 * from the `occurredAt` the brand typed: a brand can backdate a delivery to the moment of
 * purchase, which would otherwise close the shopper's return window and release the money at
 * once. `deliveredAt` stays the reported time, for display.
 */
export function deriveFulfilment(state: Pick<OrderStateRow, "fulfilmentStatus" | "deliveredAt" | "cancelledAt">, order: Pick<OrderRefRow, "status">, events: ShipmentEventLite[]) {
  if (state.cancelledAt || state.fulfilmentStatus === "cancelled") return { fulfilment: "cancelled" as const, deliveredAt: null, returnWindowEndsAt: null, shipped: false }
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  const delivered = sorted.find((e) => e.status === "delivered")
  const returned = sorted.some((e) => e.status === "returned")
  const shipped = sorted.some((e) => SHIPPED.has(e.status))
  const deliveredAt = delivered?.occurredAt ?? state.deliveredAt ?? null
  const windowFrom = delivered ? new Date(Math.max(delivered.occurredAt.getTime(), delivered.recordedAt?.getTime() ?? 0)) : deliveredAt
  let fulfilment: (typeof FULFILMENT_STATES)[number]
  if (returned) fulfilment = "returned_to_sender"
  else if (deliveredAt || order.status === "delivered") fulfilment = "delivered"
  else if (shipped || order.status === "shipped") fulfilment = "shipped"
  else if (order.status === "processing" || sorted.some((e) => e.status === "label_created")) fulfilment = "processing"
  else fulfilment = "unfulfilled"
  return { fulfilment, deliveredAt, returnWindowEndsAt: windowFrom ? new Date(windowFrom.getTime() + RETURN_WINDOW_DAYS * DAY) : null, shipped: shipped || fulfilment === "delivered" }
}

export async function shipmentEventsFor(tx: Executor, orderRefIds: string[]) {
  if (!orderRefIds.length) return new Map<string, ShipmentEventLite[]>()
  const rows = await tx
    .select({ orderRefId: shipmentEvents.orderRefId, status: shipmentEvents.status, occurredAt: shipmentEvents.occurredAt, recordedAt: shipmentEvents.createdAt })
    .from(shipmentEvents)
    .where(inArray(shipmentEvents.orderRefId, orderRefIds))
    .orderBy(asc(shipmentEvents.occurredAt))
  const out = new Map<string, ShipmentEventLite[]>()
  for (const r of rows) {
    const list = out.get(r.orderRefId) ?? []
    list.push({ status: r.status, occurredAt: r.occurredAt, recordedAt: r.recordedAt })
    out.set(r.orderRefId, list)
  }
  return out
}

/** Legacy and seed order_refs have no state row: one is made from the order the first time a write touches it. */
function stateFromRef(o: OrderRefRow) {
  const payment = o.status === "refunded" ? "refunded" : o.paid ? "paid" : "pending"
  return {
    orderRefId: o.id,
    checkoutId: null,
    brandId: o.brandId,
    customerId: o.customerId,
    currency: o.currency,
    totalMinor: o.totalMinor,
    paymentStatus: payment,
    fulfilmentStatus: o.status === "cancelled" ? "cancelled" : "unfulfilled",
    returnStatus: o.status === "refund_requested" ? "requested" : "none",
    refundedMinor: o.status === "refunded" && o.paid ? o.totalMinor : 0,
    shipTo: { country: o.shipToCountry, ...(o.shipToCity ? { city: o.shipToCity } : {}) } satisfies OrderShipTo,
    cancelledAt: o.status === "cancelled" ? o.createdAt : null,
    cancelledBy: o.status === "cancelled" ? "system" : null,
    createdAt: o.createdAt,
  }
}

async function ensureState(tx: Tx, orderRefId: string) {
  const [o] = await tx.select().from(orderRefs).where(eq(orderRefs.id, orderRefId)).limit(1)
  if (!o) return null
  await tx.insert(orderStates).values(stateFromRef(o)).onConflictDoNothing()
  const items = (o.items ?? []) as OrderRefItem[]
  if (items.length) {
    // Same variant twice in an old items list: merged into one line.
    const merged = new Map<string, OrderRefItem>()
    for (const i of items) {
      const prev = merged.get(i.variantId)
      merged.set(i.variantId, prev ? { ...prev, qty: prev.qty + i.qty } : { ...i })
    }
    await tx
      .insert(orderLines)
      .values([...merged.values()].map((i, n) => ({ id: newId("ol"), orderRefId: o.id, variantId: i.variantId, productId: i.productId, title: i.name, qty: Math.max(1, i.qty), unitMinor: Math.max(0, i.unitMinor), currency: o.currency, position: n })))
      .onConflictDoNothing()
  }
  return o
}

/**
 * The order and its state row, locked FOR UPDATE for the rest of the transaction (every money or
 * state change on an order goes through here, so two writes on one order serialise).
 */
export async function lockOrder(tx: Tx, orderRefId: string): Promise<{ order: OrderRefRow; state: OrderStateRow } | null> {
  let [state] = await tx.select().from(orderStates).where(eq(orderStates.orderRefId, orderRefId)).for("update").limit(1)
  if (!state) {
    if (!(await ensureState(tx, orderRefId))) return null
    ;[state] = await tx.select().from(orderStates).where(eq(orderStates.orderRefId, orderRefId)).for("update").limit(1)
    if (!state) return null
  }
  const [order] = await tx.select().from(orderRefs).where(eq(orderRefs.id, orderRefId)).for("update").limit(1)
  if (!order) return null
  return { order, state }
}

export async function linesOf(tx: Tx, orderRefId: string) {
  return tx.select().from(orderLines).where(eq(orderLines.orderRefId, orderRefId)).orderBy(asc(orderLines.position))
}

export async function updateState(tx: Tx, orderRefId: string, patch: Partial<typeof orderStates.$inferInsert>) {
  const [row] = await tx
    .update(orderStates)
    .set({ ...patch, updatedAt: new Date(), version: sql`${orderStates.version} + 1` })
    .where(eq(orderStates.orderRefId, orderRefId))
    .returning()
  return row
}

export async function setMerchantStatus(tx: Tx, orderRefId: string, status: string, paid?: boolean) {
  await tx
    .update(orderRefs)
    .set({ status, ...(paid === undefined ? {} : { paid }) })
    .where(eq(orderRefs.id, orderRefId))
}

/** After a fulfilment-affecting change: stores what shipping's events say (writes only). */
export async function syncFulfilment(tx: Tx, order: OrderRefRow, state: OrderStateRow) {
  const events = (await shipmentEventsFor(tx, [order.id])).get(order.id) ?? []
  const f = deriveFulfilment(state, order, events)
  const patch: Partial<typeof orderStates.$inferInsert> = {}
  if (f.fulfilment !== state.fulfilmentStatus) patch.fulfilmentStatus = f.fulfilment
  if ((f.deliveredAt?.getTime() ?? null) !== (state.deliveredAt?.getTime() ?? null) || (f.deliveredAt && (f.returnWindowEndsAt?.getTime() ?? null) !== (state.returnWindowEndsAt?.getTime() ?? null))) {
    patch.deliveredAt = f.deliveredAt
    patch.returnWindowEndsAt = f.returnWindowEndsAt
  }
  // Marked delivered without a delivered event (an older order): the window starts when Yard first sees it.
  if (f.fulfilment === "delivered" && !f.deliveredAt && !state.deliveredAt) {
    const now = new Date()
    patch.deliveredAt = now
    patch.returnWindowEndsAt = new Date(now.getTime() + RETURN_WINDOW_DAYS * DAY)
  }
  if (!Object.keys(patch).length) return { state, derived: f }
  return { state: await updateState(tx, order.id, patch), derived: f }
}

/** Timeline entry. `data` holds ids, amounts and states only, never user-written text. */
export async function addEvent(tx: Tx, orderRefId: string, kind: string, actor: OrderActor, data: Record<string, unknown> = {}) {
  await tx.insert(orderEvents).values({ id: newId("oe"), orderRefId, kind, actorKind: actor.kind, actorId: actor.id, data })
}

/** Tells the order's shopper and brand to refetch (ids only, no user text: stored in the 24 h log). */
export async function announce(order: Pick<OrderRefRow, "id" | "customerId" | "brandId" | "reference">, change: string) {
  const payload = { orderId: order.id, reference: order.reference, change }
  await publish(channels.user(order.customerId), "order.updated", payload)
  await publish(channels.brand(order.brandId), "order.updated", payload)
}

/** Sum of refunds that count against the cap (pending + succeeded). */
export async function committedRefunds(tx: Executor, orderRefId: string) {
  const [r] = await tx
    .select({ total: sql<number>`coalesce(sum(${orderRefunds.amountMinor}), 0)::int` })
    .from(orderRefunds)
    .where(and(eq(orderRefunds.orderRefId, orderRefId), inArray(orderRefunds.status, ["pending", "succeeded"])))
  return Number(r?.total ?? 0)
}

/** The customer's email for transactional mail (ENGAGEMENT's outbox does the sending). */
export async function customerEmail(tx: Tx, customerId: string) {
  const u = await tx.query.users.findFirst({ where: (x, { eq }) => eq(x.id, customerId), columns: { email: true, name: true } })
  return u ?? null
}

export async function brandName(tx: Tx, brandId: string) {
  const b = await tx.query.brands.findFirst({ where: (x, { eq }) => eq(x.id, brandId), columns: { name: true } })
  return b?.name ?? "The brand"
}

export const isOrderRefId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id)

/** Absolute link to the shopper's order page, for emails. */
export const orderUrl = (orderRefId?: string) => `${getEnv().publicOrigin}/you/orders${orderRefId ? `/${orderRefId}` : ""}`

/** A shopper email about an order (ENGAGEMENT's outbox; never throws for a bad address). */
export async function emailCustomer(tx: Tx, customerId: string, template: string, vars: Record<string, string | number>, dedupeKey: string) {
  const who = await customerEmail(tx, customerId)
  if (!who?.email) return
  await enqueueEmail(tx, { template, to: who.email, vars: { name: who.name, ...vars }, dedupeKey })
}
