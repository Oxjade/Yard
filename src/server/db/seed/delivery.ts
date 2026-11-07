import "server-only"
import { and, eq, inArray, or, sql } from "drizzle-orm"
import type { MerchantOrder } from "@/lib/data/types"
import { computeEstimate, estimateValues, type EstimateCache } from "../../shipping/orders"
import { abuseEvents, auditLog, deliveryComplaints, deliveryEstimates, notifications, orderRefs, shipmentEvents } from "../schema"
import { db } from "../tx"
import type { SeedModule } from "./types"

type EventValues = typeof shipmentEvents.$inferInsert

/** Shipment events read off a sample order's timeline: "Shipped with…" → shipped, "Delivered" → delivered. */
function eventsFrom(o: MerchantOrder): EventValues[] {
  const out: EventValues[] = []
  o.timeline.forEach((t, i) => {
    const shipped = /^shipped\b/i.test(t.label)
    const delivered = /^(marked )?delivered\b/i.test(t.label)
    if (!shipped && !delivered) return
    out.push({
      id: `se_seed_${o.id}_${i}`,
      orderRefId: o.id,
      status: shipped ? "shipped" : "delivered",
      occurredAt: new Date(t.at),
      carrier: shipped ? (o.tracking?.carrier ?? null) : null,
      trackingNumber: shipped ? (o.tracking?.number ?? null) : null,
      locationText: null,
      note: null,
      source: "system",
      createdBy: null,
    })
  })
  return out
}

/**
 * Delivery (cluster D, Appendix D): shipment events from each sample order's timeline, a
 * delivery estimate per order computed by the engine (requires the orders and shipping seeds), and
 * two delivery problems: dc_seed_1 (Ada, "other": no tracking yet, on her paid Null Form order that
 * hasn't shipped) and dc_seed_2 (u_5, not received, Lagos Static).
 *
 * Re-running restores every sample order to its seeded delivery state, whatever Studio, the shopper
 * or a test did to it since: all estimates, shipment events and delivery problems on seed-sourced
 * order_refs are replaced (not only the *_seed_* ids), the order's status and paid flag go back to
 * the sample's, and the notifications, screened-text abuse rows and D's audit rows (shipments,
 * delivery problems) about those orders go.
 */
const seed: SeedModule = {
  key: "seed:delivery",
  version: 2,
  requires: ["order_refs:mo_lagos_static_901", "order_refs:mo_null_form_903", "shipping_zones:sz_seed_lagos_static_dom"],
  async run(ctx) {
    const d = await db()
    const samples = new Map([...ctx.merchantOrders, ...ctx.customerOrders].map((o) => [o.id, o]))
    const rows = await d.select().from(orderRefs).where(eq(orderRefs.source, "seed"))
    const ids = rows.map((r) => r.id)
    if (ids.length) {
      const complaintIds = (await d.select({ id: deliveryComplaints.id }).from(deliveryComplaints).where(inArray(deliveryComplaints.orderRefId, ids))).map((c) => c.id)
      const hrefs = [...ids.flatMap((id) => [`/you/orders/${id}`, `/studio/orders/${id}`, `/admin/delivery?order=${id}`]), ...complaintIds.map((c) => `/admin/delivery?complaint=${c}`)]
      for (let i = 0; i < hrefs.length; i += 500) await d.delete(notifications).where(inArray(notifications.href, hrefs.slice(i, i + 500)))
      // D's own audit rows about what this reset replaces (by subject: the sample orders and their
      // delivery problems); other clusters' decisions stay.
      const subjects = [...ids, ...complaintIds]
      for (let i = 0; i < subjects.length; i += 500)
        await d.delete(auditLog).where(and(inArray(auditLog.action, ["order.shipment_recorded", "delivery_complaint.created", "delivery_complaint.responded"]), inArray(auditLog.subjectId, subjects.slice(i, i + 500))))
      await d.delete(abuseEvents).where(sql`${abuseEvents.action} = 'delivery.brand_text' and ${abuseEvents.detail}->>'orderRefId' in (select id from order_refs where source = 'seed')`)
      await d.delete(deliveryComplaints).where(or(inArray(deliveryComplaints.orderRefId, ids), inArray(deliveryComplaints.id, ["dc_seed_1", "dc_seed_2"])))
      await d.delete(shipmentEvents).where(inArray(shipmentEvents.orderRefId, ids))
      await d.delete(deliveryEstimates).where(inArray(deliveryEstimates.orderRefId, ids))
      // Status and paid as the sample has them (the same rule as the orders seed).
      for (const row of rows) {
        const sample = samples.get(row.id)
        if (!sample) continue
        const paid = sample.paymentStatus !== "pending" && sample.paymentStatus !== "failed"
        if (row.status !== sample.status || row.paid !== paid) {
          await d.update(orderRefs).set({ status: sample.status, paid }).where(eq(orderRefs.id, row.id))
          row.status = sample.status
          row.paid = paid
        }
      }
    }
    const cache: EstimateCache = { brands: new Map(), calendars: new Map() }
    const events: EventValues[] = []
    const estimates: (typeof deliveryEstimates.$inferInsert)[] = []
    const now = ctx.now.getTime()
    for (const row of rows) {
      const sample = samples.get(row.id)
      const ev = sample ? eventsFrom(sample) : []
      events.push(...ev)
      const asRows = ev.map((e) => ({ ...e, occurredAt: e.occurredAt as Date, createdAt: ctx.now })) as (typeof shipmentEvents.$inferSelect)[]
      const { estimate, providerId } = await computeEstimate(row, asRows, now, cache)
      estimates.push(estimateValues(row.id, estimate, providerId, "seed", `de_seed_${row.id}`, row.placedAt))
    }
    for (let i = 0; i < events.length; i += 200) await d.insert(shipmentEvents).values(events.slice(i, i + 200))
    for (let i = 0; i < estimates.length; i += 200) await d.insert(deliveryEstimates).values(estimates.slice(i, i + 200))

    const day = 86_400_000
    const ada = rows.find((r) => r.id === "mo_null_form_903")
    const u5 = rows.find((r) => r.id === "mo_lagos_static_36")
    const complaints: (typeof deliveryComplaints.$inferInsert)[] = []
    // Her order is paid and not due to ship yet, so the question is about packing, not lateness.
    if (ada) complaints.push({ id: "dc_seed_1", orderRefId: ada.id, customerId: ada.customerId, brandId: ada.brandId, kind: "other", details: "No tracking yet. Can you confirm it's being packed?", status: "waiting_brand", createdAt: new Date(now - day) })
    if (u5) complaints.push({ id: "dc_seed_2", orderRefId: u5.id, customerId: u5.customerId, brandId: u5.brandId, kind: "not_received", details: "Tracking says delivered, but nothing came to my building.", status: "waiting_brand", createdAt: new Date(now - day / 2) })
    if (complaints.length) await d.insert(deliveryComplaints).values(complaints)
  },
}

export default seed
