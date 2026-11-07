import "server-only"
import { and, eq, gte, inArray, like, or, sql } from "drizzle-orm"
import type { AdminActor } from "../auth/dal"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { abuseEvents, auditLog, deliveryComplaints, messages, notifications, orderGroups, orderRefs, rateLimitBuckets, shipmentEvents } from "../db/schema"
import { forbidden, notFound, rule } from "../http/errors"
import { resetWindows } from "../security/rate-limit"
import { SCREEN_ACTION } from "./screen"

/** D's rate-limit keys (route() `rate.key`): their abuse rows for test shoppers, and their per-minute windows. */
const D_RATE_KEYS = ["orders.register", "orders.complaint", "orders.delivery", "shipping.quote", "shipping.estimate", "shipping.holidays", "studio.shipment", "studio.delivery", "studio.complaint_response", "studio.shipping.save", "studio.shipping.read"]
/** Daily buckets a kit run fills: the complaint cap, for D's test shopper and the demo shopper the browser runs act as. */
const DAILY_BUCKETS = ["orders.complaint:day:shopper:u_t_%", "orders.complaint:day:shopper:u_ada:%"]
/** The demo shopper the browser runs place orders as. */
const DEMO_SHOPPER = "u_ada"
const DAY = 86_400_000

/** Test cleanup deletes data, so only the owner and engineering admins may run it (still dev only). */
export function assertCleanupAdmin(actor: AdminActor) {
  if (actor.role !== "owner" && actor.role !== "engineering") throw forbidden("Only the owner or an engineering admin can run test cleanup.")
}

export type CleanupInput = {
  /** Checkouts this run registered (the register response's groupId). Another shopper's only when created since `since`, within a day. */
  groupIds?: string[]
  /** References, for u_t_* test shoppers' checkouts only (a reference is visible to shoppers, brands and admins). */
  references?: string[]
  /** Sweep these u_t_* test shoppers' checkouts (each must start with u_t_). */
  customers?: string[]
  /** Sweep only checkouts created from this moment on (with `customers`, both apply). */
  since?: string
  dryRun?: boolean
}

/**
 * Development only: removes what D's curl kit and browser scripts registered, so the demo accounts
 * see only the seeded sample data afterwards (§9.0 test-data hygiene).
 * - The u_t_* sweep is scoped: test shoppers named in `customers`, and/or checkouts created since
 *   `since`. With neither, nothing is swept, so a parallel run's fixtures stay put.
 * - Named checkouts: by reference only for u_t_* shoppers; by group id also for the demo shopper's
 *   own browser checkouts created since `since` and within the last day. Seeded groups never.
 * - For those orders: delivery problems, estimates and shipment events (cascade), the notifications
 *   that point at them, the abuse rows about them (screened brand text) and the audit rows whose
 *   subject is one of them. Never audit rows by time window or actor.
 * - The test shoppers' abuse rows from D's limits, the complaint daily buckets above, and (not on a
 *   dry run) D's per-minute windows, so the kits can run again at once.
 * - Orders a message refers to (an order card in Inbox) are kept and listed, since those rows are I's.
 * - Writes a `dev.cleanup` audit row with the counts (not on a dry run).
 */
export async function devCleanup(actor: AdminActor, input: CleanupInput) {
  assertCleanupAdmin(actor)
  const since = input.since ? new Date(input.since) : null
  if (since && Number.isNaN(since.getTime())) throw rule("`since` isn't a valid time.")
  const customers = input.customers ?? []
  const badCustomer = customers.find((c) => !c.startsWith("u_t_"))
  if (badCustomer) throw rule(`Only u_t_* test shoppers can be swept (got ${badCustomer}).`)
  return withTx(async () => {
    const d = await db()
    const testShopper = like(orderGroups.customerId, "u_t_%")
    // 1. The scoped sweep of test shoppers' checkouts.
    const sweepWhere = customers.length || since ? and(testShopper, customers.length ? inArray(orderGroups.customerId, customers) : undefined, since ? gte(orderGroups.createdAt, since) : undefined) : undefined
    // 2. Named checkouts.
    const refs = input.references ?? []
    const ids = input.groupIds ?? []
    const namedWhere = or(
      refs.length ? and(testShopper, inArray(orderGroups.reference, refs)) : undefined,
      ids.length ? and(testShopper, inArray(orderGroups.id, ids)) : undefined,
      ids.length && since ? and(eq(orderGroups.customerId, DEMO_SHOPPER), inArray(orderGroups.id, ids), gte(orderGroups.createdAt, since), gte(orderGroups.createdAt, new Date(Date.now() - DAY))) : undefined,
    )
    const where = or(sweepWhere, namedWhere)
    const groups = where ? await d.select({ id: orderGroups.id, reference: orderGroups.reference, customerId: orderGroups.customerId }).from(orderGroups).where(where) : []
    const orders = groups.length ? await d.select({ id: orderRefs.id, groupId: orderRefs.groupId, source: orderRefs.source }).from(orderRefs).where(inArray(orderRefs.groupId, groups.map((g) => g.id))) : []
    // Never a seeded checkout.
    const seededGroups = new Set(orders.filter((o) => o.source === "seed").map((o) => o.groupId))
    const referenced = orders.length ? new Set((await d.selectDistinct({ id: messages.orderRefId }).from(messages).where(inArray(messages.orderRefId, orders.map((o) => o.id)))).map((r) => r.id)) : new Set<string | null>()
    const keptGroups = new Set([...seededGroups, ...orders.filter((o) => referenced.has(o.id)).map((o) => o.groupId)])
    const doomedGroups = groups.filter((g) => !keptGroups.has(g.id))
    const doomedOrders = orders.filter((o) => !keptGroups.has(o.groupId)).map((o) => o.id)
    const complaints = doomedOrders.length ? await d.select({ id: deliveryComplaints.id }).from(deliveryComplaints).where(inArray(deliveryComplaints.orderRefId, doomedOrders)) : []
    const events = doomedOrders.length ? await d.select({ id: shipmentEvents.id }).from(shipmentEvents).where(inArray(shipmentEvents.orderRefId, doomedOrders)) : []
    const hrefs = [
      ...doomedOrders.flatMap((id) => [`/you/orders/${id}`, `/studio/orders/${id}`, `/admin/delivery?order=${id}`]),
      ...complaints.map((c) => `/admin/delivery?complaint=${c.id}`),
    ]
    const subjects = [...doomedOrders, ...complaints.map((c) => c.id), ...events.map((e) => e.id)]
    const notes = hrefs.length ? await d.select({ id: notifications.id }).from(notifications).where(inArray(notifications.href, hrefs)) : []
    const audits = subjects.length ? await d.select({ id: auditLog.id }).from(auditLog).where(inArray(auditLog.subjectId, subjects)) : []
    const abuse = await d
      .select({ id: abuseEvents.id })
      .from(abuseEvents)
      .where(
        or(
          and(like(abuseEvents.actorId, "u_t_%"), inArray(abuseEvents.action, D_RATE_KEYS)),
          doomedOrders.length ? and(eq(abuseEvents.action, SCREEN_ACTION), inArray(sql<string>`${abuseEvents.detail}->>'orderRefId'`, doomedOrders)) : undefined,
        ),
      )
    const buckets = await d
      .select({ key: rateLimitBuckets.key })
      .from(rateLimitBuckets)
      .where(or(...DAILY_BUCKETS.map((k) => like(rateLimitBuckets.key, k))))

    const summary = {
      abuseRows: abuse.length,
      dailyBuckets: buckets.length,
      groups: doomedGroups.map((g) => `${g.reference} (${g.customerId})`),
      orders: doomedOrders.length,
      complaints: complaints.length,
      events: events.length,
      notifications: notes.length,
      auditRows: audits.length,
      kept: [...keptGroups].map((id) => groups.find((g) => g.id === id)?.reference ?? id),
      dryRun: !!input.dryRun,
    }
    if (input.dryRun) return summary
    if (abuse.length) await d.delete(abuseEvents).where(inArray(abuseEvents.id, abuse.map((a) => a.id)))
    if (buckets.length) await d.delete(rateLimitBuckets).where(inArray(rateLimitBuckets.key, buckets.map((b) => b.key)))
    for (const k of D_RATE_KEYS) resetWindows(`${k}:`)
    if (notes.length) await d.delete(notifications).where(inArray(notifications.id, notes.map((n) => n.id)))
    if (audits.length) await d.delete(auditLog).where(inArray(auditLog.id, audits.map((a) => a.id)))
    if (complaints.length) await d.delete(deliveryComplaints).where(inArray(deliveryComplaints.id, complaints.map((c) => c.id)))
    // Estimates and shipment events go with their order (on delete cascade).
    if (doomedOrders.length) await d.delete(orderRefs).where(inArray(orderRefs.id, doomedOrders))
    if (doomedGroups.length) await d.delete(orderGroups).where(inArray(orderGroups.id, doomedGroups.map((g) => g.id)))
    await writeAudit({
      actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
      action: "dev.cleanup",
      target: "Delivery test data (development only)",
      meta: { groups: doomedGroups.length, orders: doomedOrders.length, complaints: complaints.length, events: events.length, notifications: notes.length, auditRows: audits.length, abuseRows: abuse.length, dailyBuckets: buckets.length },
    })
    return summary
  })
}

/** The demo shopper's (or a test shopper's) non-seed checkouts, newest first (what a browser run may have left). */
export async function devListPlaced(actor: AdminActor, customerId: string) {
  assertCleanupAdmin(actor)
  const d = await db()
  const rows = await d.select({ id: orderGroups.id, reference: orderGroups.reference, createdAt: orderGroups.createdAt }).from(orderGroups).where(eq(orderGroups.customerId, customerId))
  const seed = new Set((await d.selectDistinct({ id: orderRefs.groupId }).from(orderRefs).where(and(eq(orderRefs.customerId, customerId), eq(orderRefs.source, "seed")))).map((r) => r.id))
  return rows.filter((r) => !seed.has(r.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => ({ id: r.id, reference: r.reference, createdAt: r.createdAt.toISOString() }))
}

/**
 * Development only, a stand-in for the payment provider and order management this build doesn't
 * have: marks a test order paid, or cancelled, on the server, so the kits can exercise the shipment
 * rules. Only a browser-placed order of a u_t_* test shopper, or of the demo shopper placed within
 * the last day. Nothing in the app calls it; it writes an audit row (`dev.order_state`), which
 * cleanup removes with the order.
 */
export async function devSetOrderState(actor: AdminActor, orderId: string, state: "paid" | "cancelled") {
  assertCleanupAdmin(actor)
  return withTx(async () => {
    const d = await db()
    const o = await d.query.orderRefs.findFirst({ where: (x, { eq }) => eq(x.id, orderId) })
    const allowed = o && o.source === "browser" && (o.customerId.startsWith("u_t_") || (o.customerId === DEMO_SHOPPER && o.createdAt.getTime() > Date.now() - DAY))
    if (!o || !allowed) throw notFound()
    const set = state === "paid" ? { paid: true, status: o.status === "pending_payment" ? "paid" : o.status } : { status: "cancelled" }
    const [row] = await d.update(orderRefs).set(set).where(eq(orderRefs.id, o.id)).returning({ id: orderRefs.id, status: orderRefs.status, paid: orderRefs.paid })
    await writeAudit({ actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role }, action: "dev.order_state", target: `Order ${o.reference}: ${state} (development only, no payment taken)`, subjectType: "order_ref", subjectId: o.id, brandId: o.brandId, meta: { state } })
    return { ...row, note: "Development only: no payment was taken." }
  })
}
