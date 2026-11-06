import "server-only"
import { eq, inArray, like } from "drizzle-orm"
import type { MerchantOrder } from "@/lib/data/types"
import { computeEstimate, estimateValues, type EstimateCache } from "../../shipping/orders"
import { deliveryComplaints, deliveryEstimates, orderRefs, shipmentEvents } from "../schema"
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
 * two delivery problems: dc_seed_1 (Ada, late, on her Null Form order) and dc_seed_2 (u_5, not
 * received, Lagos Static). Re-running replaces these rows.
 */
const seed: SeedModule = {
  key: "seed:delivery",
  version: 1,
  requires: ["order_refs:mo_lagos_static_901", "order_refs:mo_null_form_903", "shipping_zones:sz_seed_lagos_static_dom"],
  async run(ctx) {
    const d = await db()
    await d.delete(deliveryComplaints).where(inArray(deliveryComplaints.id, ["dc_seed_1", "dc_seed_2"]))
    await d.delete(shipmentEvents).where(like(shipmentEvents.id, "se_seed_%"))
    await d.delete(deliveryEstimates).where(like(deliveryEstimates.id, "de_seed_%"))

    const samples = new Map([...ctx.merchantOrders, ...ctx.customerOrders].map((o) => [o.id, o]))
    const rows = await d.select().from(orderRefs).where(eq(orderRefs.source, "seed"))
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
    if (ada) complaints.push({ id: "dc_seed_1", orderRefId: ada.id, customerId: ada.customerId, brandId: ada.brandId, kind: "late", details: "It was meant to ship last week and there's no tracking yet.", status: "waiting_brand", createdAt: new Date(now - day) })
    if (u5) complaints.push({ id: "dc_seed_2", orderRefId: u5.id, customerId: u5.customerId, brandId: u5.brandId, kind: "not_received", details: "Tracking says delivered, but nothing came to my building.", status: "waiting_brand", createdAt: new Date(now - day / 2) })
    if (complaints.length) await d.insert(deliveryComplaints).values(complaints)
  },
}

export default seed
